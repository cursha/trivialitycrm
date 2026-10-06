// No "server-only": used by the company page's EOS card and the
// opportunity-analysis results panel (both client components).
import { EOS_CATEGORY_MAXIMA, EOS_CATEGORY_LABELS, EOS_CATEGORY_SCORING_CATEGORY, type EosCategoryScores } from "./constants";
import type { OpportunityGrade } from "@/generated/prisma/enums";

type CategoryKey = keyof typeof EOS_CATEGORY_MAXIMA;

/** Each grade's EOS range, best first — the same cut-offs as gradeForScore()
 * in ./validation (a unit test keeps the two in step). */
export const GRADE_BANDS: { grade: OpportunityGrade; min: number; max: number }[] = [
  { grade: "A_PLUS", min: 90, max: 100 },
  { grade: "A", min: 80, max: 89 },
  { grade: "B", min: 70, max: 79 },
  { grade: "C", min: 60, max: 69 },
  { grade: "D", min: 0, max: 59 },
];

export type CategoryReason = { key: CategoryKey; label: string; score: number; max: number; evidence: string | null };

export type GradeReasons = {
  grade: OpportunityGrade;
  band: { min: number; max: number };
  /** The next grade up and how many more points it needs; null at A+. */
  nextGrade: { grade: OpportunityGrade; pointsNeeded: number } | null;
  /** Categories that scored 70%+ of their maximum, best first (up to 3). */
  strengths: CategoryReason[];
  /** Categories that lost the most points, worst first (up to 3). */
  holdbacks: CategoryReason[];
  /** Rules that changed the AI's own scores, in plain words. */
  overrides: string[];
};

const STRENGTH_SHARE = 0.7;
const MAX_LISTED = 3;

/**
 * Why a score got its grade, from the numbers themselves: the grade's
 * range, the next grade up, which categories carried it and which held it
 * back (with the newest evidence for each), and any rule that overrode the
 * AI (Curt's call). `evidence` is newest first; only its first entry per
 * category is used.
 */
export function explainGrade(input: {
  eosTotal: number;
  categoryScores: EosCategoryScores;
  /** Confirmed no TVs/screens: the analysis zeroes turnkey readiness. */
  noTvs: boolean;
  evidence?: { category: string; evidenceSummary: string }[];
}): GradeReasons {
  const bandIndex = GRADE_BANDS.findIndex((band) => input.eosTotal >= band.min);
  const band = GRADE_BANDS[bandIndex === -1 ? GRADE_BANDS.length - 1 : bandIndex];
  const above = bandIndex > 0 ? GRADE_BANDS[bandIndex - 1] : null;

  const evidenceFor = (key: CategoryKey) => input.evidence?.find((entry) => entry.category === EOS_CATEGORY_SCORING_CATEGORY[key])?.evidenceSummary ?? null;
  const reasons: CategoryReason[] = (Object.keys(EOS_CATEGORY_MAXIMA) as CategoryKey[]).map((key) => ({
    key,
    label: EOS_CATEGORY_LABELS[key],
    score: input.categoryScores[key],
    max: EOS_CATEGORY_MAXIMA[key],
    evidence: evidenceFor(key),
  }));

  const strengths = reasons
    .filter((reason) => reason.score / reason.max >= STRENGTH_SHARE)
    .sort((a, b) => b.score / b.max - a.score / a.max || b.max - a.max)
    .slice(0, MAX_LISTED);
  const strengthKeys = new Set(strengths.map((reason) => reason.key));
  const holdbacks = reasons
    .filter((reason) => reason.score < reason.max && !strengthKeys.has(reason.key))
    .sort((a, b) => b.max - b.score - (a.max - a.score) || a.score / a.max - b.score / b.max)
    .slice(0, MAX_LISTED);

  const overrides: string[] = [];
  if (input.noTvs) {
    overrides.push(`No TVs or screens confirmed, so ${EOS_CATEGORY_LABELS.turnkeyImplementationReadiness} was set to 0 (trivia needs a screen).`);
  }

  return {
    grade: band.grade,
    band: { min: band.min, max: band.max },
    nextGrade: above ? { grade: above.grade, pointsNeeded: above.min - input.eosTotal } : null,
    strengths,
    holdbacks,
    overrides,
  };
}
