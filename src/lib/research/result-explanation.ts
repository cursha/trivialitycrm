// Deterministic presentation helpers for a single SearchResult's evidence
// panel — confidence, mock-data detection, and a recommended next action.
// No new scoring: everything here is derived from data already stored on
// the result (score/evidence/explanation/disposition), never invented.
// Pure — unit-tested directly, same convention as ./priority.ts.
import type { EvidenceEntry } from "./providers/types";

export type ResultConfidence = "HIGH" | "MEDIUM" | "LOW";

export type ResultEvidenceEntry = { verificationStatus: string; note: string };

// The mock research providers (src/lib/research/providers/mock.ts) prefix
// every note/explanation they generate with these literal markers — the
// only reliable, already-persisted signal that a given result came from
// mock data rather than a live AI call (AI_PROVIDER itself isn't stored per
// result, so it can't answer this for results from before a provider
// switch).
const MOCK_EVIDENCE_MARKER = "[Mock evidence]";
const MOCK_SCORE_MARKER = "[Mock score]";

export function isMockResearchResult(explanation: string, evidence: ResultEvidenceEntry[]): boolean {
  return explanation.startsWith(MOCK_SCORE_MARKER) || evidence.some((entry) => entry.note.startsWith(MOCK_EVIDENCE_MARKER));
}

/** HIGH: at least half the evidence (and 2+ entries) is VERIFIED.
 *  LOW: no evidence at all, or every entry is still UNVERIFIED.
 *  MEDIUM: everything in between (e.g. INFERRED entries, or a mix). */
export function computeResultConfidence(evidence: ResultEvidenceEntry[]): ResultConfidence {
  if (evidence.length === 0) return "LOW";
  const verifiedCount = evidence.filter((e) => e.verificationStatus === "VERIFIED").length;
  if (evidence.length >= 2 && verifiedCount / evidence.length >= 0.5) return "HIGH";
  const allUnverified = evidence.every((e) => e.verificationStatus === "UNVERIFIED");
  if (allUnverified) return "LOW";
  return "MEDIUM";
}

export type RecommendedActionInput = {
  disposition: string;
  score: number;
  minimumScore: number;
  triviaStatus: string;
  evidenceCount: number;
};

export function recommendResultNextAction(input: RecommendedActionInput): string {
  if (input.disposition === "REJECTED") {
    return "Rejected — restore it first if new information changes the picture.";
  }
  if (input.disposition === "TRANSFERRED") {
    return "Already transferred to the CRM pipeline.";
  }
  if (input.disposition === "DUPLICATE") {
    return "Marked as a duplicate of an existing company — no action needed.";
  }
  if (input.evidenceCount === 0) {
    return "No evidence recorded yet — run research on this business before deciding.";
  }
  if (input.triviaStatus === "UNCERTAIN") {
    return "Trivia status is still uncertain — consider running additional research before transferring.";
  }
  if (input.score < input.minimumScore) {
    return `Below this search's minimum score (${input.minimumScore}) — review the evidence carefully before transferring.`;
  }
  return "Meets the bar for this search — ready to select and transfer.";
}

/**
 * Server-stamps (never model-self-reported) a `verifiedAt` timestamp on
 * every evidence entry that's actually VERIFIED with a sourceUrl, and clears
 * it on everything else — called right after verify()/score() returns
 * (run-search.ts, results/actions.ts#researchResult). Deterministic: the
 * model never supplies this date itself, so it can never invent one for a
 * finding it merely claims is current. Competition Locator's "insufficient
 * verifiable evidence" rejection (run-search.ts, COMPETITOR mode only)
 * checks for at least one entry passing this exact bar.
 */
export function stampEvidenceVerificationDates(evidence: EvidenceEntry[]): EvidenceEntry[] {
  const now = new Date().toISOString();
  return evidence.map((entry) => ({
    ...entry,
    verifiedAt: entry.verificationStatus === "VERIFIED" && entry.sourceUrl ? now : null,
  }));
}

export function hasCurrentVerifiedEvidence(evidence: EvidenceEntry[]): boolean {
  return evidence.some((entry) => entry.verificationStatus === "VERIFIED" && !!entry.sourceUrl && !!entry.verifiedAt);
}
