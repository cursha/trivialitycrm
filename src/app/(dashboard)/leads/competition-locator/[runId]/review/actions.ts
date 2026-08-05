"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { CompetitionLocatorSaveSchema, type CompetitionLocatorRowDecision } from "@/lib/validation/competition-locator-review";
import { computeNormalizedFields } from "@/lib/duplicates/match";
import { computeContactNormalizedFields } from "@/lib/data-quality/normalize";
import { resolveFieldDecisions, type ResolvedCompanyFields } from "@/lib/companies/field-resolution";
import { readContactDataEntries } from "@/lib/research/contact-data";
import { logInitialPipelineStage } from "@/lib/companies/activity-log";
import { writeAuditEvent } from "@/lib/audit/log";
import type { ScoredDuplicateMatch } from "@/lib/duplicates/scored-match";
import type { Prisma } from "@/generated/prisma/client";

export type CompetitionLocatorSaveResult =
  | { error: string }
  | { createdCount: number; updatedCount: number; skippedContactCount: number; ignoredCount: number };

/**
 * Approve/save action for Competition Locator's review screen — a sibling
 * to transferSearchResults() (leads/transfer/actions.ts), not a
 * modification of it. Re-validates every row server-side (never trusts a
 * client-supplied bucket/target), does the whole batch inside one
 * transaction, and gates competitor assignment on the same conflict rule
 * the review screen surfaces: never silently overwritten, only ever changed
 * on explicit "assignAnyway" approval.
 */
export async function saveCompetitionLocatorResults(rawPayload: unknown): Promise<CompetitionLocatorSaveResult> {
  const user = await requireUser();
  requirePermission(user, "transfer_leads");

  const parsed = CompetitionLocatorSaveSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }
  const payload = parsed.data;

  const results = await prisma.searchResult.findMany({
    where: { id: { in: payload.rows.map((row) => row.resultId) }, search: { runCorrelationId: payload.runId } },
    include: { search: true },
  });
  const resultsById = new Map(results.map((result) => [result.id, result]));

  for (const row of payload.rows) {
    if (!resultsById.has(row.resultId)) {
      return { error: "One or more selected results are no longer available to save." };
    }
  }

  let createdCount = 0;
  let updatedCount = 0;
  let skippedContactCount = 0;
  let ignoredCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of payload.rows) {
      const result = resultsById.get(row.resultId)!;
      // Defensive — the review UI never lets a REJECTED or already-TRANSFERRED
      // row be selected, but a stale client payload must not be trusted.
      if (result.disposition === "REJECTED" || result.disposition === "TRANSFERRED") continue;

      const fresh: ResolvedCompanyFields = {
        name: result.name,
        address1: result.address1,
        city: result.city,
        region: result.region,
        postalCode: result.postalCode,
        country: result.country,
        phone: result.phone,
        email: result.email,
        websiteUrl: result.websiteUrl,
      };

      const duplicateMatches = (Array.isArray(result.duplicateMatches) ? result.duplicateMatches : []) as unknown as ScoredDuplicateMatch[];
      const topMatch = duplicateMatches[0];

      // Competitor-conflict rows: "skip" means do nothing at all for this
      // result (requirement 9 — never auto-resolve).
      if (result.competitorConflict && row.competitorConflictResolution === "skip") {
        ignoredCount++;
        continue;
      }

      let companyId: string;

      if (topMatch && row.duplicateResolution === "ignore") {
        await tx.searchResult.update({ where: { id: row.resultId }, data: { disposition: "DUPLICATE" } });
        ignoredCount++;
        continue;
      }

      if (topMatch && row.duplicateResolution !== "create") {
        // "merge" (default) — re-validate the existing company still exists
        // rather than trusting the persisted match blindly.
        const existing = await tx.company.findUnique({ where: { id: topMatch.companyId } });
        if (!existing) {
          // Match no longer exists (e.g. archived/merged elsewhere since
          // discovery) — fall back to creating a new company.
          companyId = await createCompany(tx, user.id, result, fresh, payload);
          createdCount++;
        } else {
          const resolved = resolveFieldDecisions(row.fieldDecisions, fresh, existing);
          const assignCompetitorNow =
            !result.competitorConflict || row.competitorConflictResolution === "assignAnyway";
          const updated = await tx.company.update({
            where: { id: existing.id },
            data: {
              ...resolved,
              ...computeNormalizedFields(resolved),
              ...(assignCompetitorNow && result.search.competitorId ? { competitorId: result.search.competitorId } : {}),
              updatedById: user.id,
            },
          });
          companyId = updated.id;
          updatedCount++;

          skippedContactCount += await createContacts(tx, companyId, row, existing.id);

          await tx.searchResult.update({ where: { id: row.resultId }, data: { disposition: "TRANSFERRED", companyId } });
          await writeAuditEvent({
            actorId: user.id,
            module: "research",
            action: "competition_locator.result_saved",
            entityType: "Company",
            entityId: companyId,
            correlationId: payload.runId,
            beforeData: { name: existing.name, competitorId: existing.competitorId },
            afterData: { name: updated.name, competitorId: updated.competitorId },
          });
          continue;
        }
      } else {
        companyId = await createCompany(tx, user.id, result, fresh, payload);
        createdCount++;
      }

      skippedContactCount += await createContacts(tx, companyId, row, null);

      await tx.searchResult.update({ where: { id: row.resultId }, data: { disposition: "TRANSFERRED", companyId } });
      await writeAuditEvent({
        actorId: user.id,
        module: "research",
        action: "competition_locator.result_saved",
        entityType: "Company",
        entityId: companyId,
        correlationId: payload.runId,
        afterData: { name: result.name, competitorId: result.search.competitorId },
      });
    }
    // Prisma's array-form/callback $transaction defaults to a 5s
    // interactive-transaction timeout — fine for one or two rows, but this
    // loop does real per-row work (company create/update, contact dedup
    // checks, an audit event write) and a realistic batch confirmed live
    // exceeded 5s ("A query cannot be executed on an expired transaction
    // ... 5367 ms passed"). Matches the same fix already applied to
    // run-search.ts's own bulk-checkpoint transaction for the identical
    // reason.
  }, { timeout: 60_000 });

  revalidatePath("/companies");
  return { createdCount, updatedCount, skippedContactCount, ignoredCount };
}

async function createCompany(
  tx: Prisma.TransactionClient,
  userId: string,
  result: { competitorId: string | null; search: { leadTypeId: string; competitorId: string | null }; triviaStatus: "CURRENT_TRIVIA" | "NO_CURRENT_TRIVIA" | "UNCERTAIN" },
  fresh: ResolvedCompanyFields,
  payload: { assignedToId: string; pipelineStageId: string },
): Promise<string> {
  const normalized = computeNormalizedFields(fresh);
  const company = await tx.company.create({
    data: {
      ...fresh,
      leadTypeId: result.search.leadTypeId,
      pipelineStageId: payload.pipelineStageId,
      competitorId: result.search.competitorId,
      assignedToId: payload.assignedToId,
      triviaStatus: result.triviaStatus,
      createdById: userId,
      source: "AI_RESEARCH",
      ...normalized,
    },
  });
  await logInitialPipelineStage(tx, { companyId: company.id, userId, toStageId: company.pipelineStageId });
  return company.id;
}

/**
 * Creates every approved contact, skipping one that normalized-matches a
 * contact already on the target company — genuinely new logic the
 * single-contact AI-research transfer flow never needed (it only ever
 * creates one contact on a brand-new company, never checking for an
 * existing match). Returns how many were skipped as duplicates.
 */
async function createContacts(
  tx: Prisma.TransactionClient,
  companyId: string,
  row: CompetitionLocatorRowDecision,
  existingCompanyId: string | null,
): Promise<number> {
  const contacts = readContactDataEntries(row.contacts);
  if (contacts.length === 0) return 0;

  const existingContacts = existingCompanyId
    ? await tx.contact.findMany({ where: { companyId: existingCompanyId, status: "ACTIVE" } })
    : [];

  let skipped = 0;
  for (const contact of contacts) {
    if (!contact.firstName || !contact.lastName) continue;
    const normalized = computeContactNormalizedFields(contact);
    const isDuplicate = existingContacts.some(
      (existing) =>
        (existing.normalizedFirstName === normalized.normalizedFirstName && existing.normalizedLastName === normalized.normalizedLastName) ||
        (!!normalized.normalizedEmail && existing.normalizedEmail === normalized.normalizedEmail) ||
        (!!normalized.normalizedPhone && existing.normalizedPhone === normalized.normalizedPhone),
    );
    if (isDuplicate) {
      skipped++;
      continue;
    }
    await tx.contact.create({
      data: {
        companyId,
        firstName: contact.firstName,
        lastName: contact.lastName,
        title: contact.title ?? null,
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        ...normalized,
      },
    });
  }
  return skipped;
}
