import type { LeadSearchMode } from "../../generated/prisma/enums";
import type { ResearchCandidate } from "./providers/types";

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

/** Drops candidates that repeat an earlier one in the same run (same
 * normalized name + city), so a single search never returns the same
 * location twice regardless of how the provider queried each city. */
export function dedupeWithinRun<T extends { name: string; city: string }>(candidates: T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.name.trim().toLowerCase()}|${candidate.city.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
