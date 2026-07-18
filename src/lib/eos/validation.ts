import { EOS_CATEGORY_MAXIMA, EOS_CATEGORY_LABELS, type EosCategoryScores } from "./constants";
import type { OpportunityGrade, PrimaryClassification } from "@/generated/prisma/enums";

/**
 * These are pure validation rules, prepared ahead of the future EOS-1.0
 * scoring engine. No score is generated here — this module only checks
 * whether a set of scores (however they were produced) is internally
 * consistent.
 */

export function gradeForScore(score: number): OpportunityGrade {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError("EOS score must be between 0 and 100.");
  }
  if (score >= 90) return "A_PLUS";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

export function gradeMatchesScore(score: number, grade: OpportunityGrade): boolean {
  return gradeForScore(score) === grade;
}

/** No category may be below 0 or above its maximum. */
export function validateCategoryScores(scores: EosCategoryScores): string[] {
  const errors: string[] = [];

  for (const key of Object.keys(EOS_CATEGORY_MAXIMA) as (keyof EosCategoryScores)[]) {
    const value = scores[key];
    const max = EOS_CATEGORY_MAXIMA[key];
    const label = EOS_CATEGORY_LABELS[key];

    if (value < 0) errors.push(`${label} cannot be below 0.`);
    if (value > max) errors.push(`${label} cannot exceed ${max}.`);
  }

  return errors;
}

export function totalFromCategoryScores(scores: EosCategoryScores): number {
  return (Object.keys(EOS_CATEGORY_MAXIMA) as (keyof EosCategoryScores)[]).reduce((sum, key) => sum + scores[key], 0);
}

/** The EOS total must equal the sum of category scores, and stay within 0-100. */
export function validateEosTotal(total: number, scores: EosCategoryScores): string[] {
  const errors: string[] = [];
  const computed = totalFromCategoryScores(scores);

  if (total !== computed) {
    errors.push(`EOS total (${total}) must equal the sum of category scores (${computed}).`);
  }
  if (total < 0 || total > 100) {
    errors.push("EOS total must be between 0 and 100.");
  }

  return errors;
}

/**
 * Replacement and Entertainment-Ready cannot both apply. This matters
 * before a raw set of candidate classifications collapses into the single
 * `primaryClassification` value a Company/HistoricalScoreRecord actually
 * stores — the schema itself can only ever hold one, but a future scoring
 * engine's intermediate reasoning may consider several before choosing.
 */
export function hasConflictingClassification(candidates: PrimaryClassification[]): boolean {
  return candidates.includes("REPLACEMENT") && candidates.includes("ENTERTAINMENT_READY");
}

/**
 * Existing customers and do-not-contact companies must never appear in
 * active prospect rankings. A reusable Prisma where-clause fragment for
 * whatever future ranking query needs it.
 */
export function activeProspectRankingWhere() {
  return { isExistingCustomer: false, doNotContact: false } as const;
}

export function isEligibleForActiveRanking(company: { isExistingCustomer: boolean; doNotContact: boolean }): boolean {
  return !company.isExistingCustomer && !company.doNotContact;
}
