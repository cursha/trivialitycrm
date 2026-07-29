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
import { logger } from "@/lib/logger";
import type { OpportunityGrade, Weekday } from "@/generated/prisma/enums";

export type AnalyzeOpportunityResult =
  | { error: string }
  | {
      companyId: string;
      name: string;
      eosTotal: number;
      opportunityGrade: OpportunityGrade;
      // AI's own holistic priority judgment — distinct from eosTotal (the
      // raw category-score sum). Surfaced to the client specifically so a
      // hard disqualifier (e.g. confirmed no TVs/screens — see the
      // provider's prompt) can sink a company to the bottom of the
      // opportunity-analysis-panel's ranked list even when its unrelated
      // category scores (food/beverage, weeknight revenue, etc.) still look
      // fine on their own.
      salesPriorityScore: number | null;
      recommendedNextAction: string;
      needsReview: boolean;
      evidence: OpportunityAnalysisEvidence[];
      hasTvs: boolean | null;
      // Trivia-specific competitor finding — see
      // Company.competitorTriviaProvider's schema.prisma comment. null when
      // no positive evidence of an existing trivia competitor was found.
      competitorTriviaProvider: string | null;
      competitorTriviaDay: Weekday | null;
    };

/**
 * The AI-driven half of EOS-1.0: fills in the same 10 categories a human
 * would via recordHistoricalScore() (src/app/(dashboard)/companies/[id]/eos/
 * actions.ts), for one already-existing Company. Modeled directly on
 * researchResult() (src/app/(dashboard)/leads/searches/[id]/results/
 * actions.ts) but scoped to a Company instead of a SearchResult.
 *
 * Deliberately NOT itself a Server Action (no "use server" file) — it takes
 * an `onProgress` function parameter, which can't cross the client/server
 * action RPC boundary anyway, and this is only ever called from other
 * server-side code: the streaming Route Handler
 * (src/app/api/companies/[id]/analyze-opportunity/route.ts, which is what
 * opportunity-analysis-panel.tsx actually calls) and the thin Server Action
 * wrapper in src/app/(dashboard)/companies/opportunity-analysis.ts kept for
 * tests/programmatic callers that just want the final result.
 *
 * The Route Handler exists because a plain Server Action holding one HTTP
 * request open for the whole call hit Railway's 5-minute proxy idle-timeout
 * live on a long analysis — streaming keeps data continuously flowing
 * instead, and each real web_search/web_fetch call becomes a genuine
 * progress update via `onProgress`, not a synthetic timer.
 */
export async function runOpportunityAnalysis(
  companyId: string,
  onProgress?: (message: string) => void,
): Promise<AnalyzeOpportunityResult> {
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
    result = await getOpportunityAnalysisProvider().analyze(input, onProgress ? (event) => onProgress(event.message) : undefined);
  } catch (error) {
    // The user only ever sees classifyProviderError()'s generic safe
    // message (by design — never leak raw provider text) — log the real
    // error here so a repeat failure is actually diagnosable from Railway's
    // log stream instead of guessed at blind a second time.
    logger.error({ err: error, companyId, companyName: company.name }, "opportunity analysis failed");
    return { error: classifyProviderError(error).safeMessage };
  }

  const categoryErrors = validateCategoryScores(result.categoryScores);
  if (categoryErrors.length > 0) {
    return { error: `Opportunity analysis returned invalid scores: ${categoryErrors[0]}` };
  }

  // Tri-state: an inconclusive (null) pass never overwrites a previously
  // confirmed true/false finding — see Company.hasTvs's schema.prisma
  // comment for why (a later "couldn't confirm either way" run shouldn't
  // erase an earlier, genuine finding).
  const hasTvs = result.hasTvs ?? company.hasTvs;

  // Black-and-white hard requirement, enforced HERE in code rather than
  // trusted to the model having correctly applied its own prompt
  // instructions on every call — a confirmed absence of TVs/screens
  // deterministically overrides both the turnkeyImplementationReadiness
  // category score and the AI's own salesPriorityScore judgment, regardless
  // of what it actually returned for either.
  const categoryScores = hasTvs === false ? { ...result.categoryScores, turnkeyImplementationReadiness: 0 } : result.categoryScores;
  const salesPriorityScore = hasTvs === false ? 0 : result.salesPriorityScore;

  const eosTotal = totalFromCategoryScores(categoryScores);
  const opportunityGrade = gradeForScore(eosTotal);
  const needsReview = result.conflict.found || company.needsReview;

  // Resolve the found provider name against the existing Competitor list by
  // exact, case-insensitive name — same "link only on a confident match,
  // never invent a new Competitor record" precedent as run-search.ts's own
  // competitorName resolution. A non-match leaves Company.competitorId
  // untouched rather than clearing it — an AI finding that doesn't match a
  // known name isn't evidence the previously-linked competitor is gone.
  const matchedCompetitor = result.competitorFound
    ? await prisma.competitor.findFirst({ where: { name: { equals: result.competitorFound.providerName, mode: "insensitive" } } })
    : null;

  await prisma.$transaction(async (tx) => {
    const created = await tx.historicalScoreRecord.create({
      data: {
        companyId,
        eosTotal,
        ...categoryScores,
        opportunityGrade,
        confidenceLevel: result.confidenceLevel,
        primaryClassification: result.primaryClassification,
        secondaryTags: result.secondaryTags,
        salesPriorityScore,
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
        salesPriorityScore,
        scoreExplanation: result.scoreExplanation,
        verifiedEvidenceSummary: result.verifiedEvidenceSummary,
        inferredEvidenceSummary: result.inferredEvidenceSummary,
        missingInformation: result.missingInformation,
        recommendedSalesApproach: result.recommendedSalesApproach,
        recommendedNextAction: result.recommendedNextAction,
        lastScoredAt: new Date(),
        scoringVersion: "ai-v1",
        currentHistoricalScoreId: created.id,
        hasTvs,
        // Fill-blank-only: never overwrite an existing email with an
        // AI-found one — the user's rule is "trust what's already there."
        email: company.email ?? result.foundEmail,
        // Only ever set to true here — a human clears it via
        // clearNeedsReview(), same "never silently un-reject" precedent as
        // restoreResult() in the lead-search results flow.
        ...(result.conflict.found ? { needsReview: true, needsReviewReason: result.conflict.reason } : {}),
        // Fill-only-on-genuine-finding, same rule as hasTvs above: an
        // inconclusive pass (competitorFound null) never erases a
        // previously confirmed competitor finding.
        ...(result.competitorFound
          ? {
              competitorTriviaProvider: result.competitorFound.providerName,
              competitorTriviaDay: result.competitorFound.day,
              ...(matchedCompetitor ? { competitorId: matchedCompetitor.id } : {}),
            }
          : {}),
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
    salesPriorityScore,
    recommendedNextAction: result.recommendedNextAction,
    needsReview,
    evidence: result.evidence,
    hasTvs,
    competitorTriviaProvider: result.competitorFound?.providerName ?? null,
    competitorTriviaDay: result.competitorFound?.day ?? null,
  };
}
