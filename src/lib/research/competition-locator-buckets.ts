// Pure, unit-tested classification logic for Competition Locator's review
// screen — no DB access, no side effects. Kept separate from the review
// page itself so the bucketing rules can be tested directly (see
// tests/unit/competition-locator-buckets.test.ts).

export type CompetitionLocatorBucket = "new" | "existingWithNewInfo" | "possibleDuplicate" | "competitorConflict" | "rejectedUnverified";

export type BucketableResult = {
  disposition: string;
  competitorConflict: boolean;
  duplicateConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
};

/**
 * Competitor-conflict takes priority over duplicate confidence — per
 * requirement 9, an existing company with a different competitor already on
 * file must always be routed to its own bucket for an explicit decision,
 * even when the match is also HIGH-confidence. REJECTED always wins
 * outright: a result that failed verification never reaches any
 * approve/merge bucket regardless of what else is true about it.
 */
export function groupSearchResult(result: BucketableResult): CompetitionLocatorBucket {
  if (result.disposition === "REJECTED") return "rejectedUnverified";
  if (result.competitorConflict) return "competitorConflict";
  if (result.duplicateConfidence === "HIGH") return "existingWithNewInfo";
  if (result.duplicateConfidence === "MEDIUM" || result.duplicateConfidence === "LOW") return "possibleDuplicate";
  return "new";
}

export const BUCKET_LABELS: Record<CompetitionLocatorBucket, string> = {
  new: "New companies",
  existingWithNewInfo: "Existing companies with new information",
  possibleDuplicate: "Possible duplicates",
  competitorConflict: "Competitor conflicts",
  rejectedUnverified: "Rejected / unverified",
};

export type FieldClassification = "identical" | "blank" | "new" | "conflicting";

/**
 * Classifies one field for the side-by-side existing-vs-new compare view.
 * "identical" also covers the case where the existing value is present and
 * the newly found value is blank — there's nothing to gain by changing it,
 * so no decision is needed (the existing value simply carries forward).
 * Only "conflicting" fields need an explicit user choice; the UI can render
 * blank/new/identical fields without a decision control at all.
 */
export function classifyField(existingValue: string | null, newValue: string | null): FieldClassification {
  const existingBlank = !existingValue || existingValue.trim() === "";
  const newBlank = !newValue || newValue.trim() === "";
  if (existingBlank && newBlank) return "blank";
  if (existingBlank && !newBlank) return "new";
  if (newBlank) return "identical";
  return existingValue === newValue ? "identical" : "conflicting";
}
