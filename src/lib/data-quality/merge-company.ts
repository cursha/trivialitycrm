// Safe, transactional company merge — the app's first true "merge"
// operation. Reassigns every FK enumerated against the schema in the
// approved plan (Conflicts #1/#3/#4), applies the caller's field
// decisions, tombstones the loser (never deletes it), and writes both the
// human-readable Activity narrative and the structured
// DataQualityAuditEvent — same "narrative + structured twin" split
// logPipelineChange already establishes (src/lib/companies/activity-log.ts).
import "server-only";
import { z } from "zod";
import { prisma } from "../prisma";
import type { Prisma } from "../../generated/prisma/client";

export const MERGEABLE_COMPANY_FIELDS = [
  "name",
  "address1",
  "city",
  "region",
  "postalCode",
  "country",
  "phone",
  "email",
  "websiteUrl",
  "notes",
  "leadTypeId",
  "pipelineStageId",
  "competitorId",
  "assignedToId",
  "triviaStatus",
  "doNotContact",
] as const;

export type MergeableCompanyField = (typeof MERGEABLE_COMPANY_FIELDS)[number];

export const CompanyFieldDecisionsSchema = z.partialRecord(z.enum(MERGEABLE_COMPANY_FIELDS), z.union([z.string(), z.boolean(), z.null()]));

export type CompanyFieldDecisions = z.infer<typeof CompanyFieldDecisionsSchema>;

export type CompanyMergeParams = {
  survivingCompanyId: string;
  mergedCompanyId: string;
  fieldDecisions: CompanyFieldDecisions;
  /** Whole-record EOS decision (see the plan's Conflict #4) — never a
   * per-category cherry-pick. "surviving" (default behavior even if
   * omitted) keeps the survivor's own current score untouched; "merged"
   * adopts the merged company's current score as the survivor's new
   * current score, reassigning its HistoricalScoreRecord history rows so
   * the pointer stays valid. */
  eosChoice?: "surviving" | "merged";
  actorId: string;
  potentialDuplicateId?: string;
};

export class CompanyMergeError extends Error {}

/**
 * Resolves a possibly-chained mergedIntoId pointer to its final surviving
 * company, bounded to avoid an infinite loop if data were ever
 * inconsistent. Used by the /companies/[id] redirect and by this module's
 * own repeated-merge guard.
 */
export async function resolveSurvivingCompanyId(companyId: string, maxHops = 10): Promise<string> {
  let currentId = companyId;
  for (let hop = 0; hop < maxHops; hop++) {
    const company = await prisma.company.findUnique({ where: { id: currentId }, select: { mergedIntoId: true } });
    if (!company || !company.mergedIntoId) return currentId;
    currentId = company.mergedIntoId;
  }
  return currentId;
}

export async function mergeCompanies(params: CompanyMergeParams): Promise<void> {
  const { survivingCompanyId, mergedCompanyId, fieldDecisions, eosChoice = "surviving", actorId, potentialDuplicateId } = params;

  if (survivingCompanyId === mergedCompanyId) {
    throw new CompanyMergeError("A company cannot be merged into itself.");
  }

  await prisma.$transaction(async (tx) => {
    const [surviving, merged] = await Promise.all([
      tx.company.findUnique({ where: { id: survivingCompanyId } }),
      tx.company.findUnique({ where: { id: mergedCompanyId } }),
    ]);

    if (!surviving) throw new CompanyMergeError("Surviving company not found.");
    if (!merged) throw new CompanyMergeError("Company to merge not found.");
    if (surviving.status === "MERGED") {
      throw new CompanyMergeError("The surviving company has itself already been merged into another company — pick its current survivor instead.");
    }
    if (merged.status === "MERGED") {
      throw new CompanyMergeError("This company has already been merged into another company.");
    }

    const beforeData = { surviving, merged };

    // --- Reassign every FK that points at the merged company -------------
    await tx.contact.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.companySource.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.evidenceRecord.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.historicalScoreRecord.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.activity.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.task.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.pipelineStageHistory.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.searchResult.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.emailMessage.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.appointment.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });
    await tx.sequenceEnrollment.updateMany({ where: { companyId: mergedCompanyId }, data: { companyId: survivingCompanyId } });

    // --- Conflict #3: SequenceEnrollment has no DB-level unique constraint
    // per (company, sequence) — only enrollInSequence()'s app-level check.
    // The reassignment above can leave the surviving company with more
    // than one ACTIVE/PAUSED enrollment in the same sequence; cancel all
    // but the most-recently-enrolled one rather than leave a silent
    // inconsistency. No new enum value needed — CANCELLED + a clear
    // stopReason already exists.
    const survivorEnrollments = await tx.sequenceEnrollment.findMany({
      where: { companyId: survivingCompanyId, status: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: { enrolledAt: "desc" },
    });
    const seenSequenceIds = new Set<string>();
    for (const enrollment of survivorEnrollments) {
      if (seenSequenceIds.has(enrollment.sequenceId)) {
        await tx.sequenceEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "CANCELLED", stoppedAt: new Date(), stopReason: "Superseded by company merge." },
        });
      } else {
        seenSequenceIds.add(enrollment.sequenceId);
      }
    }

    // --- Apply the caller's field decisions to the survivor --------------
    const updateData: Record<string, unknown> = { updatedById: actorId };
    for (const [field, value] of Object.entries(fieldDecisions)) {
      updateData[field] = value;
    }

    // --- Conflict #4: EOS is a whole-record decision, never per-category.
    if (eosChoice === "merged" && merged.currentHistoricalScoreId) {
      updateData.currentHistoricalScoreId = merged.currentHistoricalScoreId;
      updateData.eosScore = merged.eosScore;
      updateData.opportunityGrade = merged.opportunityGrade;
      updateData.confidenceLevel = merged.confidenceLevel;
      updateData.primaryClassification = merged.primaryClassification;
      updateData.secondaryTags = merged.secondaryTags;
      updateData.salesPriorityScore = merged.salesPriorityScore;
      updateData.scoreExplanation = merged.scoreExplanation;
      updateData.verifiedEvidenceSummary = merged.verifiedEvidenceSummary;
      updateData.inferredEvidenceSummary = merged.inferredEvidenceSummary;
      updateData.missingInformation = merged.missingInformation;
      updateData.recommendedSalesApproach = merged.recommendedSalesApproach;
      updateData.recommendedNextAction = merged.recommendedNextAction;
      updateData.lastScoredAt = merged.lastScoredAt;
      updateData.scoringVersion = merged.scoringVersion;
    }

    // The merged company's own currentHistoricalScoreId pointer must be
    // cleared before it's tombstoned — @unique on Company.
    // currentHistoricalScoreId means the same HistoricalScoreRecord row
    // can't be "current" for two companies at once, and it's being
    // reassigned to survivingCompanyId's ownership above regardless of
    // which side's score wins.
    await tx.company.update({ where: { id: mergedCompanyId }, data: { currentHistoricalScoreId: null } });

    const updatedSurvivor = await tx.company.update({ where: { id: survivingCompanyId }, data: updateData });

    const tombstoned = await tx.company.update({
      where: { id: mergedCompanyId },
      data: { status: "MERGED", mergedIntoId: survivingCompanyId, mergedAt: new Date(), mergedById: actorId },
    });

    await tx.activity.create({
      data: {
        companyId: survivingCompanyId,
        userId: actorId,
        type: "COMPANY_MERGED",
        notes: `Merged company "${merged.name}" into this record.`,
      },
    });

    await tx.dataQualityAuditEvent.create({
      data: {
        action: "COMPANY_MERGED",
        actorId,
        companyId: survivingCompanyId,
        potentialDuplicateId: potentialDuplicateId ?? null,
        beforeData: beforeData as unknown as Prisma.InputJsonValue,
        afterData: { surviving: updatedSurvivor, merged: tombstoned } as unknown as Prisma.InputJsonValue,
        metadata: { fieldDecisions, eosChoice } as unknown as Prisma.InputJsonValue,
      },
    });

    if (potentialDuplicateId) {
      await tx.potentialDuplicate.update({
        where: { id: potentialDuplicateId },
        data: { status: "MERGED", reviewedAt: new Date(), reviewedById: actorId },
      });
    }
  });
}
