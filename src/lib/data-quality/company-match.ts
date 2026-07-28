// Pairwise company duplicate scoring. Builds on the existing
// src/lib/duplicates/match.ts/normalize.ts (exact/normalized signals) plus
// this module's own computeAddressNormalizedFields (src/lib/data-quality/
// normalize.ts) and hand-rolled similarity.ts (fuzzy signal). Never used to
// auto-merge — a human always reviews a PotentialDuplicate row before any
// merge happens (src/lib/data-quality/merge-company.ts).
import { normalizeAddressLine } from "../duplicates/normalize";
import { similarityScore } from "./similarity";

export type CompanyMatchInput = {
  id: string;
  name: string;
  normalizedName: string;
  address1: string | null;
  city: string;
  region: string;
  country: string;
  postalCode: string | null;
  normalizedRegion: string | null;
  normalizedCity: string | null;
  normalizedPostalCode: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  normalizedEmail: string | null;
  websiteUrl: string | null;
  websiteDomain: string | null;
};

export type MatchScoreResult = {
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  matchedFields: string[];
  conflictingFields: string[];
};

/**
 * Scores a candidate company pair, 0–100. `minFuzzySimilarity` is the
 * DUPLICATE_FUZZY_MATCH rule's configured threshold (default 85) — a fuzzy
 * name signal below it contributes nothing. A fuzzy-only match (no exact
 * email/phone/website/normalized-name/address signal) is structurally
 * capped at LOW confidence, regardless of score — "fuzzy name similarity
 * alone must not automatically merge anything."
 */
export function scoreCompanyMatch(a: CompanyMatchInput, b: CompanyMatchInput, minFuzzySimilarity = 85): MatchScoreResult {
  let score = 0;
  const reasons: string[] = [];
  const matchedFields: string[] = [];
  const conflictingFields: string[] = [];
  let hasStrongSignal = false;

  if (a.normalizedEmail && b.normalizedEmail && a.normalizedEmail === b.normalizedEmail) {
    score += 35;
    reasons.push("Email addresses match exactly.");
    matchedFields.push("email");
    hasStrongSignal = true;
  }

  if (a.normalizedPhone && b.normalizedPhone && a.normalizedPhone === b.normalizedPhone) {
    score += 30;
    reasons.push("Phone numbers match.");
    matchedFields.push("phone");
    hasStrongSignal = true;
  }

  if (a.websiteDomain && b.websiteDomain && a.websiteDomain === b.websiteDomain) {
    score += 25;
    reasons.push("Website domains match.");
    matchedFields.push("websiteUrl");
    hasStrongSignal = true;
  }

  const exactNameMatch = a.normalizedName === b.normalizedName;
  if (exactNameMatch) {
    score += 20;
    reasons.push("Company names match after normalization.");
    matchedFields.push("name");
    hasStrongSignal = true;
  } else {
    const similarity = similarityScore(a.normalizedName, b.normalizedName);
    if (similarity >= minFuzzySimilarity) {
      // Scaled so a threshold-grazing match contributes little and a
      // near-identical (but not exact) name contributes close to the full
      // 15 — never counted alongside the exact-name bonus above.
      const bonus = Math.round(((similarity - minFuzzySimilarity) / (100 - minFuzzySimilarity)) * 15);
      score += Math.max(1, bonus);
      reasons.push(`Company names are very similar (${similarity}% match).`);
      matchedFields.push("name");
    } else if (a.name.trim() && b.name.trim()) {
      conflictingFields.push("name");
    }
  }

  const addressMatch =
    a.address1 &&
    b.address1 &&
    normalizeAddressLine(a.address1) === normalizeAddressLine(b.address1) &&
    a.normalizedPostalCode &&
    a.normalizedPostalCode === b.normalizedPostalCode &&
    a.country.trim().toLowerCase() === b.country.trim().toLowerCase();

  if (addressMatch) {
    score += 25;
    reasons.push("Street address and postal/ZIP code match.");
    matchedFields.push("address1");
    hasStrongSignal = true;
  }

  // Corroborating signal only -- sharing a city/region is common and must
  // never by itself be enough to flag a pair (two unrelated companies both
  // in Toronto is not evidence of a duplicate). Only counted when some
  // other identity signal above already matched.
  if (matchedFields.length > 0 && a.normalizedCity && b.normalizedCity && a.normalizedCity === b.normalizedCity && a.normalizedRegion === b.normalizedRegion) {
    score += 8;
    reasons.push("Same city and region.");
    matchedFields.push("city");
  } else if (a.normalizedCity && b.normalizedCity && a.normalizedCity !== b.normalizedCity) {
    conflictingFields.push("city");
  }

  if (a.email && b.email && a.normalizedEmail !== b.normalizedEmail) conflictingFields.push("email");
  if (a.phone && b.phone && a.normalizedPhone !== b.normalizedPhone) conflictingFields.push("phone");
  if (a.websiteDomain && b.websiteDomain && a.websiteDomain !== b.websiteDomain) conflictingFields.push("websiteUrl");

  score = Math.min(100, score);

  let confidence: MatchScoreResult["confidence"] = "LOW";
  if (hasStrongSignal && score >= 80) confidence = "HIGH";
  else if (hasStrongSignal && score >= 50) confidence = "MEDIUM";
  else if (!hasStrongSignal) confidence = "LOW";
  else confidence = "LOW";

  return { score, confidence, reasons, matchedFields, conflictingFields };
}
