"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { TransferPayloadSchema, type TransferPayload } from "@/lib/validation/transfer";
import { findPotentialDuplicates, computeNormalizedFields } from "@/lib/duplicates/match";
import type { DuplicateMatch } from "@/lib/duplicates/match";

export type TransferResult =
  | { error: string }
  | { duplicates: Record<string, DuplicateMatch[]> }
  | { transferredCount: number };

/**
 * Validates every selected row up front (including duplicate checks) before
 * touching the database, then transfers all of them in a single
 * transaction. If any row is invalid or blocked by an un-overridden
 * duplicate, NOTHING is written — this is the "partial bulk transfers must
 * not corrupt data" guarantee from requirement 8, verified by the
 * rollback-on-partial-failure test.
 */
export async function transferSearchResults(rawPayload: TransferPayload): Promise<TransferResult> {
  const user = await requireUser();
  requirePermission(user, "transfer_leads");

  const parsed = TransferPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }
  const payload = parsed.data;

  const results = await prisma.searchResult.findMany({
    where: { id: { in: payload.rows.map((row) => row.resultId) }, disposition: { not: "TRANSFERRED" } },
    include: { search: true },
  });
  const resultsById = new Map(results.map((result) => [result.id, result]));

  const duplicatesByRow: Record<string, DuplicateMatch[]> = {};
  for (const row of payload.rows) {
    const source = resultsById.get(row.resultId);
    if (!source) {
      return { error: "One or more selected results are no longer available to transfer." };
    }
    if (row.overrideDuplicate && user.role.name !== "Administrator") {
      return { error: "Only an Administrator can transfer despite a possible duplicate match." };
    }
    if (!row.overrideDuplicate) {
      const matches = await findPotentialDuplicates(prisma, row);
      if (matches.length > 0) duplicatesByRow[row.resultId] = matches;
    }
  }

  if (Object.keys(duplicatesByRow).length > 0) {
    return { duplicates: duplicatesByRow };
  }

  await prisma.$transaction(async (tx) => {
    for (const row of payload.rows) {
      const source = resultsById.get(row.resultId)!;
      const normalized = computeNormalizedFields(row);

      const company = await tx.company.create({
        data: {
          name: row.name,
          address1: row.address1 ?? null,
          city: row.city,
          region: row.region,
          postalCode: row.postalCode ?? null,
          country: row.country,
          phone: row.phone ?? null,
          email: row.email ?? null,
          websiteUrl: row.websiteUrl ?? null,
          leadTypeId: source.search.leadTypeId,
          pipelineStageId: payload.pipelineStageId,
          competitorId: source.competitorId,
          assignedToId: payload.assignedToId,
          triviaStatus: source.triviaStatus,
          createdById: user.id,
          ...normalized,
        },
      });

      if (row.contactFirstName && row.contactLastName) {
        await tx.contact.create({
          data: {
            companyId: company.id,
            firstName: row.contactFirstName,
            lastName: row.contactLastName,
            phone: row.contactPhone ?? null,
            email: row.contactEmail ?? null,
            title: row.contactTitle ?? null,
          },
        });
      }

      await tx.searchResult.update({
        where: { id: row.resultId },
        data: { disposition: "TRANSFERRED", companyId: company.id },
      });

      await tx.activity.create({
        data: {
          companyId: company.id,
          userId: user.id,
          type: "LEAD_TRANSFERRED",
          notes: `Transferred from research search ${source.searchId} (result score ${source.score}). Prompt: "${source.search.promptSnapshot.slice(0, 200)}".`,
        },
      });
    }
  });

  revalidatePath("/companies");
  return { transferredCount: payload.rows.length };
}
