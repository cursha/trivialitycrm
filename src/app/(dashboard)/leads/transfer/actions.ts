"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { TransferPayloadSchema, type TransferPayload } from "@/lib/validation/transfer";
import { findPotentialDuplicates, computeNormalizedFields } from "@/lib/duplicates/match";
import type { DuplicateMatch } from "@/lib/duplicates/match";
import { logInitialPipelineStage } from "@/lib/companies/activity-log";
import { resolveReplaceOrMergeFields, type ResolvedCompanyFields } from "@/lib/companies/field-resolution";

export type TransferResult =
  | { error: string }
  | { duplicates: Record<string, DuplicateMatch[]> }
  | { transferredCount: number; ignoredCount: number };

type SourceResult = Awaited<ReturnType<typeof loadSourceResults>>[number];

async function loadSourceResults(resultIds: string[]) {
  return prisma.searchResult.findMany({
    where: { id: { in: resultIds }, disposition: { not: "TRANSFERRED" } },
    include: { search: true },
  });
}

type RowPlan =
  | { action: "create" }
  | { action: "ignore" }
  | { action: "replace" | "merge"; targetCompanyId: string };

/**
 * Validates every selected row up front (including duplicate checks) before
 * touching the database, then transfers all of them in a single
 * transaction. If any row is invalid or blocked by an un-resolved
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

  const results = await loadSourceResults(payload.rows.map((row) => row.resultId));
  const resultsById = new Map<string, SourceResult>(results.map((result) => [result.id, result]));

  const duplicatesByRow: Record<string, DuplicateMatch[]> = {};
  const plans = new Map<string, RowPlan>();

  for (const row of payload.rows) {
    const source = resultsById.get(row.resultId);
    if (!source) {
      return { error: "One or more selected results are no longer available to transfer." };
    }

    if (row.duplicateAction && user.role.name !== "Administrator") {
      return { error: "Only an Administrator can resolve a possible duplicate match." };
    }

    if (!row.duplicateAction) {
      const matches = await findPotentialDuplicates(prisma, row);
      if (matches.length > 0) {
        duplicatesByRow[row.resultId] = matches;
        continue;
      }
      plans.set(row.resultId, { action: "create" });
      continue;
    }

    if (row.duplicateAction === "ignore") {
      plans.set(row.resultId, { action: "ignore" });
      continue;
    }

    // "replace"/"merge": re-validate the chosen target is a genuine match,
    // rather than trusting a client-supplied company id outright.
    const matches = await findPotentialDuplicates(prisma, row);
    if (matches.length === 0) {
      // No longer a duplicate (e.g. resolved elsewhere in the meantime) —
      // fall back to a normal create rather than blocking the transfer.
      plans.set(row.resultId, { action: "create" });
      continue;
    }
    const targetCompanyId = row.duplicateTargetCompanyId ?? (matches.length === 1 ? matches[0].id : undefined);
    if (!targetCompanyId || !matches.some((match) => match.id === targetCompanyId)) {
      return { error: `Choose which existing company to ${row.duplicateAction} for "${row.name}".` };
    }
    plans.set(row.resultId, { action: row.duplicateAction, targetCompanyId });
  }

  if (Object.keys(duplicatesByRow).length > 0) {
    return { duplicates: duplicatesByRow };
  }

  let transferredCount = 0;
  let ignoredCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of payload.rows) {
      const source = resultsById.get(row.resultId)!;
      const plan = plans.get(row.resultId)!;

      if (plan.action === "ignore") {
        // Must actually write something, not just skip in memory — a
        // no-op here would leave the result NEW/REVIEWED, so it would hit
        // this exact same duplicate prompt again on a future transfer
        // attempt instead of the decision being genuinely recorded.
        // DUPLICATE is an existing disposition (already wired into the
        // results-table UI) that had never been written by any code path.
        await tx.searchResult.update({ where: { id: row.resultId }, data: { disposition: "DUPLICATE" } });
        ignoredCount++;
        continue;
      }

      let companyId: string;

      if (plan.action === "create") {
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
            source: "AI_RESEARCH",
            ...normalized,
          },
        });
        await logInitialPipelineStage(tx, { companyId: company.id, userId: user.id, toStageId: company.pipelineStageId });
        companyId = company.id;
      } else {
        const existing = await tx.company.findUniqueOrThrow({ where: { id: plan.targetCompanyId } });
        const fresh: ResolvedCompanyFields = {
          name: row.name,
          address1: row.address1 ?? null,
          city: row.city,
          region: row.region,
          postalCode: row.postalCode ?? null,
          country: row.country,
          phone: row.phone ?? null,
          email: row.email ?? null,
          websiteUrl: row.websiteUrl ?? null,
        };
        const resolved = resolveReplaceOrMergeFields(plan.action, fresh, existing);
        const updated = await tx.company.update({
          where: { id: plan.targetCompanyId },
          data: {
            ...resolved,
            ...computeNormalizedFields(resolved),
            triviaStatus: plan.action === "replace" || existing.triviaStatus === "UNCERTAIN" ? source.triviaStatus : existing.triviaStatus,
            updatedById: user.id,
          },
        });
        companyId = updated.id;
      }

      if (row.contactFirstName && row.contactLastName) {
        await tx.contact.create({
          data: {
            companyId,
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
        data: { disposition: "TRANSFERRED", companyId },
      });

      const actionLabel = plan.action === "create" ? "Transferred" : plan.action === "replace" ? "Replaced existing company from" : "Merged into existing company from";
      await tx.activity.create({
        data: {
          companyId,
          userId: user.id,
          type: "LEAD_TRANSFERRED",
          notes: `${actionLabel} research search ${source.searchId} (result score ${source.score}). Prompt: "${source.search.promptSnapshot.slice(0, 200)}".`,
        },
      });

      transferredCount++;
    }
  });

  revalidatePath("/companies");
  return { transferredCount, ignoredCount };
}
