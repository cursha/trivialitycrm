import type { LeadSearchMode } from "../../generated/prisma/enums";
import type { ResearchCandidate } from "./providers/types";
import { normalizeAddressLine } from "../duplicates/normalize";

/**
 * Requirement 3: a location must never appear in both the "offers events but
 * not trivia" group and the "currently offers trivia" group for the same
 * research scope. Positive evidence is required to call a location
 * CURRENT_TRIVIA; a TRIVIA_GAP search whose provider nonetheless returns a
 * confirmed-trivia candidate is contradicting its own scope, so that
 * candidate is dropped here rather than silently miscategorized.
 *
 * This is the defensive backstop — providers are also instructed not to
 * produce these candidates in the first place (see modeInstructions in
 * anthropic.ts and the mode branching in mock.ts).
 */
export function filterByModeExclusivity(candidates: ResearchCandidate[], mode: LeadSearchMode): ResearchCandidate[] {
  if (mode === "TRIVIA_GAP") {
    return candidates.filter((candidate) => candidate.triviaStatus !== "CURRENT_TRIVIA");
  }
  if (mode === "TRIVIA_CONFIRMED") {
    // Uncertain results must not be treated as confirmed — only keep
    // candidates the provider was able to positively confirm.
    return candidates.filter((candidate) => candidate.triviaStatus === "CURRENT_TRIVIA");
  }
  return candidates;
}

/** Drops candidates that repeat an earlier one in the same run, so a single
 * search never returns the same location twice regardless of how the
 * provider queried each city. Keyed on address1 (+ postalCode) rather than
 * city where available — a multi-city search (e.g. "Toronto" split into
 * Toronto/Scarborough/Etobicoke/... to get past Google's 60-results-per-query
 * ceiling, see google-places.ts) can have the SAME business turn up from two
 * different city queries, each candidate carrying the query's city rather
 * than the business's actual city, so a city-keyed dedupe would have missed
 * it. Falls back to city only when a candidate has no address1 (e.g. an AI
 * candidate that couldn't confirm one). */
export function dedupeWithinRun<T extends { name: string; city: string; address1: string | null; postalCode: string | null }>(
  candidates: T[],
): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const location = candidate.address1
      ? `${normalizeAddressLine(candidate.address1)}|${candidate.postalCode?.trim().toLowerCase() ?? ""}`
      : candidate.city.trim().toLowerCase();
    const key = `${candidate.name.trim().toLowerCase()}|${location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
