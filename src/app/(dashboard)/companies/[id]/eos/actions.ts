"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { HistoricalScoreEntrySchema, EvidenceEntrySchema } from "@/lib/validation/eos";
import { gradeForScore, totalFromCategoryScores, validateCategoryScores } from "@/lib/eos/validation";
import { formString } from "@/lib/form-data";

export type EosActionResult = { error?: string } | undefined;

async function requireCompanyAccess(companyId: string) {
  const user = await requireUser();
  requirePermission(user, "edit_leads");

  const scope = companyScope(user);
  if (!scope) {
    throw new Error("Forbidden: no access to this company");
  }

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) {
    throw new Error("Forbidden: no access to this company");
  }

  return user;
}

export async function recordHistoricalScore(
  companyId: string,
  _prevState: EosActionResult,
  formData: FormData,
): Promise<EosActionResult> {
  const user = await requireCompanyAccess(companyId);

  const parsed = HistoricalScoreEntrySchema.safeParse({
    foodBeverageFocus: formString(formData, "foodBeverageFocus"),
    weeknightRevenueOpportunity: formString(formData, "weeknightRevenueOpportunity"),
    communityEngagement: formString(formData, "communityEngagement"),
    existingEventCulture: formString(formData, "existingEventCulture"),
    groupSeatingLayout: formString(formData, "groupSeatingLayout"),
    capacityOperationalSuitability: formString(formData, "capacityOperationalSuitability"),
    decisionMakerAccessibility: formString(formData, "decisionMakerAccessibility"),
    marketingActivityVisibility: formString(formData, "marketingActivityVisibility"),
    turnkeyImplementationReadiness: formString(formData, "turnkeyImplementationReadiness"),
    competitiveOpportunity: formString(formData, "competitiveOpportunity"),
    confidenceLevel: formString(formData, "confidenceLevel"),
    primaryClassification: formString(formData, "primaryClassification"),
    secondaryTags: formData.getAll("secondaryTags"),
    salesPriorityScore: formString(formData, "salesPriorityScore") || undefined,
    scoreExplanation: formString(formData, "scoreExplanation"),
    verifiedEvidenceSummary: formString(formData, "verifiedEvidenceSummary"),
    inferredEvidenceSummary: formString(formData, "inferredEvidenceSummary"),
    missingInformation: formString(formData, "missingInformation"),
    recommendedSalesApproach: formString(formData, "recommendedSalesApproach"),
    recommendedNextAction: formString(formData, "recommendedNextAction"),
    scoringVersion: formString(formData, "scoringVersion"),
    isExistingCustomer: formData.get("isExistingCustomer") === "on",
    isQualified: formData.get("isQualified") === "on",
    doNotContact: formData.get("doNotContact") === "on",
    exclusionReason: formString(formData, "exclusionReason"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const categoryScores = {
    foodBeverageFocus: parsed.data.foodBeverageFocus,
    weeknightRevenueOpportunity: parsed.data.weeknightRevenueOpportunity,
    communityEngagement: parsed.data.communityEngagement,
    existingEventCulture: parsed.data.existingEventCulture,
    groupSeatingLayout: parsed.data.groupSeatingLayout,
    capacityOperationalSuitability: parsed.data.capacityOperationalSuitability,
    decisionMakerAccessibility: parsed.data.decisionMakerAccessibility,
    marketingActivityVisibility: parsed.data.marketingActivityVisibility,
    turnkeyImplementationReadiness: parsed.data.turnkeyImplementationReadiness,
    competitiveOpportunity: parsed.data.competitiveOpportunity,
  };

  const categoryErrors = validateCategoryScores(categoryScores);
  if (categoryErrors.length > 0) {
    return { error: categoryErrors[0] };
  }

  const eosTotal = totalFromCategoryScores(categoryScores);
  const opportunityGrade = gradeForScore(eosTotal);

  await prisma.$transaction(async (tx) => {
    const created = await tx.historicalScoreRecord.create({
      data: {
        companyId,
        eosTotal,
        ...categoryScores,
        opportunityGrade,
        confidenceLevel: parsed.data.confidenceLevel,
        primaryClassification: parsed.data.primaryClassification,
        secondaryTags: parsed.data.secondaryTags,
        salesPriorityScore: parsed.data.salesPriorityScore ?? null,
        scoreExplanation: parsed.data.scoreExplanation ?? null,
        recommendedSalesApproach: parsed.data.recommendedSalesApproach ?? null,
        recommendedNextAction: parsed.data.recommendedNextAction ?? null,
        scoringVersion: parsed.data.scoringVersion,
        scoredById: user.id,
      },
    });

    // Historical score records are never overwritten — this write only
    // ever inserts a new row. Company gets the denormalized "latest" view
    // for fast listing, and the pointer identifies which row is current.
    await tx.company.update({
      where: { id: companyId },
      data: {
        eosScore: eosTotal,
        opportunityGrade,
        confidenceLevel: parsed.data.confidenceLevel,
        primaryClassification: parsed.data.primaryClassification,
        secondaryTags: parsed.data.secondaryTags,
        salesPriorityScore: parsed.data.salesPriorityScore ?? null,
        scoreExplanation: parsed.data.scoreExplanation ?? null,
        verifiedEvidenceSummary: parsed.data.verifiedEvidenceSummary ?? null,
        inferredEvidenceSummary: parsed.data.inferredEvidenceSummary ?? null,
        missingInformation: parsed.data.missingInformation ?? null,
        recommendedSalesApproach: parsed.data.recommendedSalesApproach ?? null,
        recommendedNextAction: parsed.data.recommendedNextAction ?? null,
        lastScoredAt: new Date(),
        scoringVersion: parsed.data.scoringVersion,
        isExistingCustomer: parsed.data.isExistingCustomer,
        isQualified: parsed.data.isQualified,
        doNotContact: parsed.data.doNotContact,
        exclusionReason: parsed.data.exclusionReason ?? null,
        currentHistoricalScoreId: created.id,
      },
    });
  });

  revalidatePath(`/companies/${companyId}`);
}

export async function addEvidence(companyId: string, _prevState: EosActionResult, formData: FormData): Promise<EosActionResult> {
  const user = await requireCompanyAccess(companyId);

  const parsed = EvidenceEntrySchema.safeParse({
    category: formString(formData, "category"),
    sourceType: formString(formData, "sourceType"),
    sourceUrl: formString(formData, "sourceUrl"),
    evidenceSummary: formString(formData, "evidenceSummary"),
    evidenceDate: formString(formData, "evidenceDate"),
    verificationStatus: formString(formData, "verificationStatus"),
    reliability: formString(formData, "reliability"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  await prisma.evidenceRecord.create({
    data: {
      companyId,
      category: parsed.data.category,
      sourceType: parsed.data.sourceType ?? null,
      sourceUrl: parsed.data.sourceUrl ?? null,
      evidenceSummary: parsed.data.evidenceSummary,
      evidenceDate: parsed.data.evidenceDate ? new Date(parsed.data.evidenceDate) : null,
      verificationStatus: parsed.data.verificationStatus,
      reliability: parsed.data.reliability,
      createdById: user.id,
    },
  });

  revalidatePath(`/companies/${companyId}`);
}

/**
 * Clears the "Needs review" flag an AI opportunity analysis (src/app/
 * (dashboard)/companies/opportunity-analysis.ts) sets when it finds a
 * conflict with trusted CRM data. Only ever cleared here, by a human —
 * the analysis action itself only ever sets it to true.
 */
export async function clearNeedsReview(companyId: string): Promise<EosActionResult> {
  await requireCompanyAccess(companyId);

  await prisma.company.update({
    where: { id: companyId },
    data: { needsReview: false, needsReviewReason: null },
  });

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
  return undefined;
}

/**
 * Direct human override for the black-and-white "has TVs/screens" gate
 * (Company.hasTvs — see its schema.prisma comment). Same edit_leads gate as
 * every other EOS-panel action. Unlike the AI analysis path, a human can set
 * this back to `null` ("unknown" — e.g. a wrong earlier entry that needs
 * re-checking) as well as true/false; the AI's own analyze-opportunity.ts
 * merge logic never does that (an inconclusive AI pass never erases a
 * confirmed finding), but a human explicitly choosing "Unknown" here is a
 * deliberate reset, not an accidental erosion.
 */
export async function setHasTvs(companyId: string, value: boolean | null): Promise<EosActionResult> {
  await requireCompanyAccess(companyId);

  await prisma.company.update({
    where: { id: companyId },
    data: { hasTvs: value },
  });

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
  return undefined;
}
