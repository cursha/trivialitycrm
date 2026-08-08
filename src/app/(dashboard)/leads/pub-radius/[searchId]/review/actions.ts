"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PubRadiusSaveSchema, type PubRadiusRowDecision } from "@/lib/validation/pub-radius-review";
import { computeNormalizedFields } from "@/lib/duplicates/match";
import { computeContactNormalizedFields, computeAddressNormalizedFields } from "@/lib/data-quality/normalize";
import { resolveFieldDecisions, type ResolvedCompanyFields } from "@/lib/companies/field-resolution";
import { readContactDataEntries } from "@/lib/research/contact-data";
import { logInitialPipelineStage } from "@/lib/companies/activity-log";
import { writeAuditEvent } from "@/lib/audit/log";
import type { ScoredDuplicateMatch } from "@/lib/duplicates/scored-match";
import type { Prisma } from "@/generated/prisma/client";

export type PubRadiusSaveResult = { error: string } | { createdCount: number; updatedCount: number; skippedContactCount: number; ignoredCount: number };

/**
 * Approve/save action for Pub Lead Finder's review screen — fork of
 * saveCompetitionLocatorResults() (competition-locator/[runId]/review/
 * actions.ts) with the competitor-conflict branch and competitor-field
 * stamping (competitorId/competitorTriviaProvider/competitorTriviaDay)
 * removed entirely — there is no competitor concept in this mode. Queries
 * by search.id directly, not runCorrelationId (a PUB_RADIUS run is always
 * exactly one LeadSearch). Everything else — merge/create/ignore
 * resolution, field conflict resolution, contact dedup, transaction
 * shape/timeout — is unchanged.
 */
export async function savePubRadiusResults(rawPayload: unknown): Promise<PubRadiusSaveResult> {
  const user = await requireUser();
  requirePermission(user, "transfer_leads");

  const parsed = PubRadiusSaveSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }
  const payload = parsed.data;

  const results = await prisma.searchResult.findMany({
    where: { id: { in: payload.rows.map((row) => row.resultId) }, search: { id: payload.searchId } },
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

  await prisma.$transaction(
    async (tx) => {
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
            const updated = await tx.company.update({
              where: { id: existing.id },
              data: {
                ...resolved,
                ...computeNormalizedFields(resolved),
                // Same reason as Competition Locator's own save action:
                // without this, normalizedCity/Region/PostalCode stay null
                // forever, which silently breaks scoreCompanyMatch()'s
                // city-conflict check on this record going forward.
                ...computeAddressNormalizedFields(resolved),
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
              action: "pub_radius.result_saved",
              entityType: "Company",
              entityId: companyId,
              correlationId: payload.searchId,
              beforeData: { name: existing.name },
              afterData: { name: updated.name },
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
          action: "pub_radius.result_saved",
          entityType: "Company",
          entityId: companyId,
          correlationId: payload.searchId,
          afterData: { name: result.name },
        });
      }
      // Same 60s timeout as Competition Locator's own save action, and for
      // the same reason — real per-row work (company create/update, contact
      // dedup checks, an audit event write) exceeds Prisma's 5s default for
      // a realistic batch.
    },
    { timeout: 60_000 },
  );

  revalidatePath("/companies");
  return { createdCount, updatedCount, skippedContactCount, ignoredCount };
}

async function createCompany(
  tx: Prisma.TransactionClient,
  userId: string,
  result: {
    triviaStatus: "CURRENT_TRIVIA" | "NO_CURRENT_TRIVIA" | "UNCERTAIN";
    search: { leadTypeId: string };
  },
  fresh: ResolvedCompanyFields,
  payload: { assignedToId: string; pipelineStageId: string },
): Promise<string> {
  const normalized = { ...computeNormalizedFields(fresh), ...computeAddressNormalizedFields(fresh) };
  const company = await tx.company.create({
    data: {
      ...fresh,
      leadTypeId: result.search.leadTypeId,
      pipelineStageId: payload.pipelineStageId,
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

/** Identical to Competition Locator's own createContacts — skips a contact
 * that normalized-matches one already on the target company. */
async function createContacts(
  tx: Prisma.TransactionClient,
  companyId: string,
  row: PubRadiusRowDecision,
  existingCompanyId: string | null,
): Promise<number> {
  const contacts = readContactDataEntries(row.contacts);
  if (contacts.length === 0) return 0;

  const existingContacts = existingCompanyId ? await tx.contact.findMany({ where: { companyId: existingCompanyId, status: "ACTIVE" } }) : [];

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
