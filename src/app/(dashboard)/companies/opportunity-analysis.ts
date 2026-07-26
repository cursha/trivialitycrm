"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { checkAiBudget } from "@/lib/ai/budget";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { getOpportunityAnalysisProvider } from "@/lib/research/providers/factory";
import type { OpportunityAnalysisInput, OpportunityAnalysisEvidence } from "@/lib/research/providers/types";
import { classifyProviderError } from "@/lib/integrations/provider-errors";
import { gradeForScore, totalFromCategoryScores, validateCategoryScores } from "@/lib/eos/validation";
import { writeAuditEvent } from "@/lib/audit/log";
import type { OpportunityGrade } from "@/generated/prisma/enums";

export type AnalyzeOpportunityResult =
  | { error: string }
  | {
      companyId: string;
      name: string;
      eosTotal: number;
      opportunityGrade: OpportunityGrade;
      recommendedNextAction: string;
      needsReview: boolean;
      evidence: OpportunityAnalysisEvidence[];
    };

/**
 * The AI-driven half of EOS-1.0: fills in the same 10 categories a human
 * would via recordHistoricalScore() (src/app/(dashboard)/companies/[id]/eos/
 * actions.ts), for one already-existing Company. Modeled directly on
 * researchResult() (src/app/(dashboard)/leads/searches/[id]/results/
 * actions.ts) but scoped to a Company instead of a SearchResult, and called
 * once per selected company from opportunity-analysis-panel.tsx's client
 * loop — not a single all-companies-in-one-transaction bulk function like
 * bulk-actions.ts, since progressive per-company feedback is the point.
 */
export async function analyzeCompanyOpportunity(companyId: string): Promise<AnalyzeOpportunityResult> {
  const user = await requireUser();
  requirePermission(user, "run_research");
  requirePermission(user, "bulk_update_leads");
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to this company." };

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope }, include: { leadType: true } });
  if (!company) return { error: "Company not found or access denied." };

  const budgetCheck = await checkAiBudget();
  if (!budgetCheck.allowed) return { error: budgetCheck.reason ?? "AI research is currently unavailable." };

  // More generous than researchResult()'s single-row 5/60s — this is meant
  // to be run across a whole selected batch, not one row at a time.
  const rateLimit = await checkRateLimit(`analyze-opportunity:${user.id}`, { windowMs: 5 * 60_000, limit: 30 });
  if (!rateLimit.allowed) return { error: "Too many analysis requests — wait a moment and try again." };

  const input: OpportunityAnalysisInput = {
    name: company.name,
    address1: company.address1,
    city: company.city,
    region: company.region,
    postalCode: company.postalCode,
    country: company.country,
    phone: company.phone,
    email: company.email,
    websiteUrl: company.websiteUrl,
    notes: company.notes,
    leadTypeName: company.leadType.name,
    userId: user.id,
  };

  let result;
  try {
    result = await getOpportunityAnalysisProvider().analyze(input);
  } catch (error) {
    return { error: classifyProviderError(error).safeMessage };
  }

  const categoryErrors = validateCategoryScores(result.categoryScores);
  if (categoryErrors.length > 0) {
    return { error: `Opportunity analysis returned invalid scores: ${categoryErrors[0]}` };
  }

  const eosTotal = totalFromCategoryScores(result.categoryScores);
  const opportunityGrade = gradeForScore(eosTotal);
  const needsReview = result.conflict.found || company.needsReview;

  await prisma.$transaction(async (tx) => {
    const created = await tx.historicalScoreRecord.create({
      data: {
        companyId,
        eosTotal,
        ...result.categoryScores,
        opportunityGrade,
        confidenceLevel: result.confidenceLevel,
        primaryClassification: result.primaryClassification,
        secondaryTags: result.secondaryTags,
        salesPriorityScore: result.salesPriorityScore,
        scoreExplanation: result.scoreExplanation,
        recommendedSalesApproach: result.recommendedSalesApproach,
        recommendedNextAction: result.recommendedNextAction,
        scoringVersion: "ai-v1",
        scoredById: null,
        scoringSource: "anthropic-opportunity-analysis",
      },
    });

    if (result.evidence.length > 0) {
      await tx.evidenceRecord.createMany({
        data: result.evidence.map((entry) => ({
          companyId,
          category: entry.category,
          sourceUrl: entry.sourceUrl,
          evidenceSummary: entry.evidenceSummary,
          verificationStatus: entry.verificationStatus,
          reliability: entry.reliability,
          createdById: user.id,
        })),
      });
    }

    await tx.company.update({
      where: { id: companyId },
      data: {
        eosScore: eosTotal,
        opportunityGrade,
        confidenceLevel: result.confidenceLevel,
        primaryClassification: result.primaryClassification,
        secondaryTags: result.secondaryTags,
        salesPriorityScore: result.salesPriorityScore,
        scoreExplanation: result.scoreExplanation,
        verifiedEvidenceSummary: result.verifiedEvidenceSummary,
        inferredEvidenceSummary: result.inferredEvidenceSummary,
        missingInformation: result.missingInformation,
        recommendedSalesApproach: result.recommendedSalesApproach,
        recommendedNextAction: result.recommendedNextAction,
        lastScoredAt: new Date(),
        scoringVersion: "ai-v1",
        currentHistoricalScoreId: created.id,
        // Fill-blank-only: never overwrite an existing email with an
        // AI-found one — the user's rule is "trust what's already there."
        email: company.email ?? result.foundEmail,
        // Only ever set to true here — a human clears it via
        // clearNeedsReview(), same "never silently un-reject" precedent as
        // restoreResult() in the lead-search results flow.
        ...(result.conflict.found ? { needsReview: true, needsReviewReason: result.conflict.reason } : {}),
      },
    });
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "eos",
    action: "opportunity.analyzed",
    entityType: "Company",
    entityId: companyId,
    beforeData: { eosScore: company.eosScore, opportunityGrade: company.opportunityGrade },
    afterData: { eosScore: eosTotal, opportunityGrade },
  });

  revalidatePath("/companies");
  revalidatePath(`/companies/${companyId}`);

  return {
    companyId,
    name: company.name,
    eosTotal,
    opportunityGrade,
    recommendedNextAction: result.recommendedNextAction,
    needsReview,
    evidence: result.evidence,
  };
}
