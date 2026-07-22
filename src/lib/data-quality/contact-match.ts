// Pairwise contact duplicate scoring — same shape/philosophy as
// company-match.ts. "Company relationship" contributes as a corroborating
// signal (two same-named contacts on the same company are far likelier to
// be a data-entry duplicate than the same names across two companies).
import { similarityScore } from "./similarity";

export type ContactMatchInput = {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  normalizedFirstName: string | null;
  normalizedLastName: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  normalizedEmail: string | null;
};

export type MatchScoreResult = {
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  matchedFields: string[];
  conflictingFields: string[];
};

export function scoreContactMatch(a: ContactMatchInput, b: ContactMatchInput, minFuzzySimilarity = 85): MatchScoreResult {
  let score = 0;
  const reasons: string[] = [];
  const matchedFields: string[] = [];
  const conflictingFields: string[] = [];
  let hasStrongSignal = false;

  if (a.normalizedEmail && b.normalizedEmail && a.normalizedEmail === b.normalizedEmail) {
    score += 40;
    reasons.push("Email addresses match exactly.");
    matchedFields.push("email");
    hasStrongSignal = true;
  } else if (a.email && b.email) {
    conflictingFields.push("email");
  }

  if (a.normalizedPhone && b.normalizedPhone && a.normalizedPhone === b.normalizedPhone) {
    score += 30;
    reasons.push("Phone numbers match.");
    matchedFields.push("phone");
    hasStrongSignal = true;
  } else if (a.phone && b.phone) {
    conflictingFields.push("phone");
  }

  const exactNameMatch =
    a.normalizedFirstName && a.normalizedLastName && a.normalizedFirstName === b.normalizedFirstName && a.normalizedLastName === b.normalizedLastName;

  if (exactNameMatch) {
    score += 20;
    reasons.push("Names match after normalization.");
    matchedFields.push("firstName");
    matchedFields.push("lastName");
    hasStrongSignal = true;
  } else if (a.normalizedFirstName && a.normalizedLastName && b.normalizedFirstName && b.normalizedLastName) {
    const fullA = `${a.normalizedFirstName} ${a.normalizedLastName}`;
    const fullB = `${b.normalizedFirstName} ${b.normalizedLastName}`;
    const similarity = similarityScore(fullA, fullB);
    if (similarity >= minFuzzySimilarity) {
      const bonus = Math.round(((similarity - minFuzzySimilarity) / (100 - minFuzzySimilarity)) * 15);
      score += Math.max(1, bonus);
      reasons.push(`Names are very similar (${similarity}% match).`);
      matchedFields.push("firstName");
    } else {
      conflictingFields.push("firstName");
    }
  }

  if (a.companyId === b.companyId) {
    score += 10;
    reasons.push("Same company.");
    matchedFields.push("companyId");
  }

  score = Math.min(100, score);

  let confidence: MatchScoreResult["confidence"] = "LOW";
  if (hasStrongSignal && score >= 80) confidence = "HIGH";
  else if (hasStrongSignal && score >= 50) confidence = "MEDIUM";

  return { score, confidence, reasons, matchedFields, conflictingFields };
}
