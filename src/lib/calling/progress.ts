// Pure session-navigation logic — kept separate from any DB access so it's
// directly unit-testable, matching this app's established convention
// (src/lib/workspace/priority.ts, src/lib/comms/sequences.ts's
// nextActionableStep, etc.).

export type OfferableEntry = { id: string; position: number; status: "PENDING" | "COMPLETED" | "SKIPPED" };

/**
 * The next entry the guided call screen should show. Prefers the first
 * still-PENDING entry at or after `currentPosition` (normal forward
 * progress); if every remaining position has already been passed, wraps
 * around to the earliest still-PENDING entry — this is what makes a
 * "skip temporarily" entry (still PENDING, just passed over once) get
 * naturally re-offered later in the same session, per the spec's "return
 * to a previous company" / revisit requirement. Returns null once nothing
 * is PENDING (session complete).
 */
export function nextEntryToOffer<T extends OfferableEntry>(entries: T[], currentPosition: number): T | null {
  const pending = entries.filter((e) => e.status === "PENDING").sort((a, b) => a.position - b.position);
  if (pending.length === 0) return null;
  return pending.find((e) => e.position >= currentPosition) ?? pending[0];
}

export type SessionCounts = {
  total: number;
  completed: number;
  remaining: number;
  skipped: number;
};

export function summarizeEntryCounts(entries: OfferableEntry[]): SessionCounts {
  return {
    total: entries.length,
    completed: entries.filter((e) => e.status === "COMPLETED").length,
    remaining: entries.filter((e) => e.status === "PENDING").length,
    skipped: entries.filter((e) => e.status === "SKIPPED").length,
  };
}
