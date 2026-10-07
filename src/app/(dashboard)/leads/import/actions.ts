"use server";

import { revalidatePath } from "next/cache";
import { prisma, type AppPrismaClient, type AppTransactionClient } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { parseSpreadsheet, SpreadsheetParseError } from "@/lib/import/parse";
import { putUpload, getUpload, recordMapping, markImported } from "@/lib/import/batch-store";
import { mapAndValidateRow, type ImportMapping, type MappedRow } from "@/lib/validation/import";
import { findPotentialDuplicates, computeNormalizedFields } from "@/lib/duplicates/match";
import { computeAddressNormalizedFields, computeContactNormalizedFields } from "@/lib/data-quality/normalize";
import { findCompetitorByName } from "@/lib/competitors/find-or-create";
import {
  appendImportNotes,
  fieldLabel,
  fillExistingCompany,
  importedContact,
  isLinkableProvider,
  newCompanyNotes,
  newCompanyResearch,
  type ImportedContact,
} from "@/lib/import/company-fields";
import { zonedCalendarDate } from "@/lib/timezone";
import { logInitialPipelineStage } from "@/lib/companies/activity-log";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadResult = { error: string } | { sessionId: string; headers: string[]; rowCount: number; sampleRows: Record<string, string>[] };

export async function uploadSpreadsheet(formData: FormData): Promise<UploadResult> {
  const user = await requireUser();
  requirePermission(user, "import_leads");

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV or Excel file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "File is too large (max 10MB)." };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseSpreadsheet(buffer, file.name);
    if (parsed.rows.length === 0) return { error: "No data rows found in the file." };

    const sessionId = await putUpload(user.id, file.name, parsed);
    return { sessionId, headers: parsed.headers, rowCount: parsed.rows.length, sampleRows: parsed.rows.slice(0, 5) };
  } catch (error) {
    if (error instanceof SpreadsheetParseError) return { error: error.message };
    return { error: "Could not read that file — check it's a valid CSV or Excel file." };
  }
}

export type PreviewedMatch = {
  name: string;
  city: string;
  /** Labels of the empty fields this row will fill in. */
  fills: string[];
  addsNotes: boolean;
  addsContact: boolean;
};
export type PreviewedRow = { index: number; values: MappedRow; errors: string[]; warnings: string[]; match: PreviewedMatch | null };
export type PreviewResult = { error: string } | { rows: PreviewedRow[] };

const EXISTING_SELECT = {
  id: true,
  name: true,
  city: true,
  country: true,
  notes: true,
  address1: true,
  postalCode: true,
  phone: true,
  email: true,
  websiteUrl: true,
  currentEntertainment: true,
  triviaHistory: true,
  verifiedEvidenceSummary: true,
  inferredEvidenceSummary: true,
  missingInformation: true,
  recommendedSalesApproach: true,
  recommendedNextAction: true,
  triviaStatus: true,
  competitorTriviaProvider: true,
  competitorId: true,
  competitorTriviaDay: true,
  slowNight: true,
  needsReview: true,
  needsReviewReason: true,
} as const;

/** The tracked Competitor a row's provider name links to, if any. */
async function matchedCompetitorId(client: AppPrismaClient | AppTransactionClient, values: MappedRow): Promise<string | null> {
  if (!isLinkableProvider(values.competitorTriviaProvider)) return null;
  return (await findCompetitorByName(client, values.competitorTriviaProvider))?.id ?? null;
}

/** Whether a contact with this name, email or phone is already on the company. */
async function hasMatchingContact(client: AppPrismaClient | AppTransactionClient, companyId: string, contact: ImportedContact): Promise<boolean> {
  const normalized = computeContactNormalizedFields(contact);
  const existing = await client.contact.findMany({ where: { companyId, status: "ACTIVE" } });
  return existing.some(
    (other) =>
      (other.normalizedFirstName === normalized.normalizedFirstName && other.normalizedLastName === normalized.normalizedLastName) ||
      (!!normalized.normalizedEmail && other.normalizedEmail === normalized.normalizedEmail) ||
      (!!normalized.normalizedPhone && other.normalizedPhone === normalized.normalizedPhone),
  );
}

function importDate(): string {
  const { year, month, day } = zonedCalendarDate(new Date());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function previewImport(sessionId: string, mapping: ImportMapping): Promise<PreviewResult> {
  const user = await requireUser();
  requirePermission(user, "import_leads");

  const upload = await getUpload(sessionId, user.id);
  if (!upload) return { error: "This upload has expired — please upload the file again." };

  await recordMapping(sessionId, mapping);
  const today = importDate();

  const rows: PreviewedRow[] = [];
  for (const [index, rawRow] of upload.rows.entries()) {
    const { values, errors, warnings } = mapAndValidateRow(rawRow, mapping);

    let match: PreviewedMatch | null = null;
    if (errors.length === 0) {
      const matches = await findPotentialDuplicates(prisma, values);
      const existing = matches[0] ? await prisma.company.findUnique({ where: { id: matches[0].id }, select: EXISTING_SELECT }) : null;
      if (existing) {
        const { filled } = fillExistingCompany(existing, values, await matchedCompetitorId(prisma, values));
        const contact = importedContact(values);
        match = {
          name: existing.name,
          city: existing.city,
          fills: filled.map(fieldLabel),
          addsNotes: appendImportNotes(existing.notes, values, today, upload.filename) !== null,
          addsContact: !!contact && !(await hasMatchingContact(prisma, existing.id, contact)),
        };
      }
    }

    rows.push({ index, values, errors, warnings, match });
  }

  return { rows };
}

export type CommitResult = { error: string } | { importedCount: number; updatedCount: number; skippedCount: number };

/**
 * Creates a company for each selected row, or — when the row matches a
 * company already in the CRM (or one an earlier row of this import just
 * created) — fills in only that company's empty fields, appends its notes
 * under a dated header and adds its contact if it isn't there yet. A match
 * with nothing new to add counts as skipped, as does an invalid row.
 */
export async function commitImport(
  sessionId: string,
  mapping: ImportMapping,
  selectedIndexes: number[],
  leadTypeId: string,
  pipelineStageId: string,
  assignedToId: string,
): Promise<CommitResult> {
  const user = await requireUser();
  requirePermission(user, "import_leads");

  // Module Ten: a per-row-writing bulk operation (up to 5000 rows/upload)
  // had no rate limit at all. A tight window is correct here — this is a
  // rare, deliberate bulk action, not a frequent single-record write.
  const rateLimit = await checkRateLimit(`import-commit:${user.id}`, { windowMs: 60 * 60_000, limit: 5 });
  if (!rateLimit.allowed) return { error: "Too many imports recently — wait a while and try again." };

  const upload = await getUpload(sessionId, user.id);
  if (!upload) return { error: "This upload has expired — please upload the file again." };

  const today = importDate();
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  await prisma.$transaction(
    async (tx) => {
      for (const index of selectedIndexes) {
        const rawRow = upload.rows[index];
        if (!rawRow) continue;

        const { values, errors } = mapAndValidateRow(rawRow, mapping);
        if (errors.length > 0) {
          skippedCount += 1;
          continue;
        }

        const matches = await findPotentialDuplicates(tx, values);
        const competitorId = await matchedCompetitorId(tx, values);
        const contact = importedContact(values);

        if (matches.length > 0) {
          // Same physical location already exists (either pre-existing, or
          // created by an earlier row in this same import). Repeated rows
          // are also how one spreadsheet gives a company several contacts.
          const existing = await tx.company.findUniqueOrThrow({ where: { id: matches[0].id }, select: EXISTING_SELECT });
          const { data } = fillExistingCompany(existing, values, competitorId);
          const notes = appendImportNotes(existing.notes, values, today, upload.filename);
          const addContact = !!contact && !(await hasMatchingContact(tx, existing.id, contact));

          if (Object.keys(data).length === 0 && notes === null && !addContact) {
            skippedCount += 1;
            continue;
          }

          if (Object.keys(data).length > 0 || notes !== null) {
            const normalized = computeNormalizedFields({
              name: existing.name,
              phone: data.phone ?? existing.phone,
              email: data.email ?? existing.email,
              websiteUrl: data.websiteUrl ?? existing.websiteUrl,
            });
            await tx.company.update({
              where: { id: existing.id },
              data: {
                ...data,
                ...(data.phone ? { normalizedPhone: normalized.normalizedPhone } : {}),
                ...(data.email ? { normalizedEmail: normalized.normalizedEmail } : {}),
                ...(data.websiteUrl ? { websiteDomain: normalized.websiteDomain } : {}),
                ...(data.postalCode
                  ? { normalizedPostalCode: computeAddressNormalizedFields({ postalCode: data.postalCode, country: existing.country }).normalizedPostalCode }
                  : {}),
                ...(notes !== null ? { notes } : {}),
                updatedById: user.id,
              },
            });
          }
          if (contact && addContact) await createContact(tx, existing.id, contact);
          updatedCount += 1;
          continue;
        }

        const company = await tx.company.create({
          data: {
            name: values.name,
            address1: values.address1 || null,
            city: values.city,
            region: values.region,
            postalCode: values.postalCode || null,
            country: values.country,
            phone: values.phone || null,
            email: values.email || null,
            websiteUrl: values.websiteUrl || null,
            notes: newCompanyNotes(values),
            ...newCompanyResearch(values, competitorId),
            leadTypeId,
            pipelineStageId,
            assignedToId,
            createdById: user.id,
            source: "IMPORT",
            importBatchId: sessionId,
            ...computeNormalizedFields(values),
            ...computeAddressNormalizedFields(values),
          },
        });

        await logInitialPipelineStage(tx, { companyId: company.id, userId: user.id, toStageId: company.pipelineStageId });
        if (contact) await createContact(tx, company.id, contact);

        importedCount += 1;
      }

      // Wiped in the same transaction as the rows it produced — a crash
      // between the two can't leave the staged payload lingering while its
      // data is already live in Company/Contact.
      await markImported(tx, sessionId);
    },
    // Same 60s timeout as the research save actions: several queries per
    // row exceed Prisma's 5s default for a realistic file.
    { timeout: 60_000 },
  );

  revalidatePath("/companies");
  return { importedCount, updatedCount, skippedCount };
}

async function createContact(tx: AppTransactionClient, companyId: string, contact: ImportedContact) {
  await tx.contact.create({ data: { companyId, ...contact, ...computeContactNormalizedFields(contact) } });
}

export type TemplateActionResult = { error?: string } | undefined;

export async function saveImportTemplate(name: string, mapping: ImportMapping): Promise<TemplateActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  if (!name.trim()) return { error: "Enter a name for this mapping template." };

  await prisma.importTemplate.create({ data: { name: name.trim(), mapping, createdById: user.id } });
  revalidatePath("/leads/import/templates");
}
