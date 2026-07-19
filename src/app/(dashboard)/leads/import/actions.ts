"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { parseSpreadsheet, SpreadsheetParseError } from "@/lib/import/parse";
import { putUpload, getUpload, recordMapping, markImported } from "@/lib/import/batch-store";
import { mapAndValidateRow, type ImportMapping, type MappedRow } from "@/lib/validation/import";
import { findPotentialDuplicates, computeNormalizedFields } from "@/lib/duplicates/match";

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

export type PreviewedRow = { index: number; values: MappedRow; errors: string[]; warnings: string[]; duplicateOf: string | null };
export type PreviewResult = { error: string } | { rows: PreviewedRow[] };

export async function previewImport(sessionId: string, mapping: ImportMapping): Promise<PreviewResult> {
  const user = await requireUser();
  requirePermission(user, "import_leads");

  const upload = await getUpload(sessionId, user.id);
  if (!upload) return { error: "This upload has expired — please upload the file again." };

  await recordMapping(sessionId, mapping);

  const rows: PreviewedRow[] = [];
  for (const [index, rawRow] of upload.rows.entries()) {
    const { values, errors, warnings } = mapAndValidateRow(rawRow, mapping);

    let duplicateOf: string | null = null;
    if (errors.length === 0) {
      const matches = await findPotentialDuplicates(prisma, values);
      if (matches.length > 0) duplicateOf = matches[0].name;
    }

    rows.push({ index, values, errors, warnings, duplicateOf });
  }

  return { rows };
}

export type CommitResult = { error: string } | { importedCount: number; skippedCount: number };

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

  const upload = await getUpload(sessionId, user.id);
  if (!upload) return { error: "This upload has expired — please upload the file again." };

  let importedCount = 0;
  let skippedCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const index of selectedIndexes) {
      const rawRow = upload.rows[index];
      if (!rawRow) continue;

      const { values, errors } = mapAndValidateRow(rawRow, mapping);
      if (errors.length > 0) {
        skippedCount += 1;
        continue;
      }

      const matches = await findPotentialDuplicates(tx, values);
      const normalized = computeNormalizedFields(values);

      if (matches.length > 0) {
        // Same physical location already exists (either pre-existing, or
        // created by an earlier row in this same import) — attach this
        // row's contact instead of creating a duplicate company. This is
        // how the v1 "one contact per row" structure supports multiple
        // contacts per company (repeated rows, see MODULE_2_REPORT.md).
        if (values.contactFirstName && values.contactLastName) {
          await tx.contact.create({
            data: {
              companyId: matches[0].id,
              firstName: values.contactFirstName,
              lastName: values.contactLastName,
              phone: values.contactPhone || null,
              email: values.contactEmail || null,
              title: values.contactTitle || null,
            },
          });
        }
        skippedCount += 1;
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
          leadTypeId,
          pipelineStageId,
          assignedToId,
          createdById: user.id,
          ...normalized,
        },
      });

      if (values.contactFirstName && values.contactLastName) {
        await tx.contact.create({
          data: {
            companyId: company.id,
            firstName: values.contactFirstName,
            lastName: values.contactLastName,
            phone: values.contactPhone || null,
            email: values.contactEmail || null,
            title: values.contactTitle || null,
          },
        });
      }

      importedCount += 1;
    }

    // Wiped in the same transaction as the rows it produced — a crash
    // between the two can't leave the staged payload lingering while its
    // data is already live in Company/Contact.
    await markImported(tx, sessionId);
  });

  revalidatePath("/companies");
  return { importedCount, skippedCount };
}

export type TemplateActionResult = { error?: string } | undefined;

export async function saveImportTemplate(name: string, mapping: ImportMapping): Promise<TemplateActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_settings");

  if (!name.trim()) return { error: "Enter a name for this mapping template." };

  await prisma.importTemplate.create({ data: { name: name.trim(), mapping, createdById: user.id } });
  revalidatePath("/leads/import/templates");
}
