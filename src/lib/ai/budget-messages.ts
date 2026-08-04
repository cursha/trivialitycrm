// Deliberately its own file, with zero imports — budget.ts (where this
// logic used to live) has no "server-only" guard (the worker needs its
// getAiSettings()/checkAiBudget() exports under plain tsx), so a client
// component importing anything from it pulls the WHOLE module graph into
// the browser bundle, including prisma and Node-only server code. Confirmed
// live: that broke the production build outright ("the chunking context
// does not support external modules (request: node:module)") the moment
// search-status.tsx (a "use client" component) imported
// isBudgetBlockedReason from budget.ts. This function has no server
// dependency at all, so it lives here instead, safe for both client and
// server callers.

// The reason strings evaluateAiBudget()/checkMidRunAiBudget() (budget.ts)
// ever return for a spend-limit block — never for researchEnabled, see both
// functions' own comments on why that one is deliberately never
// override-able. Matched by substring, not exact equality, so either
// function's reason text can gain more detail later (e.g. the actual dollar
// amount) without silently breaking this check.
const BUDGET_BLOCKED_MARKERS = ["budget has been reached", "maximum per-search AI budget", "AI budget limit reached mid-run"];

/** Whether a LeadSearch.errorMessage represents a spend-limit block that a
 * "Continue anyway" override (LeadSearch.budgetOverride) can actually fix —
 * as opposed to a real provider failure, or the researchEnabled kill-switch,
 * which no per-search override can bypass. Used by the resume UI to decide
 * whether offering that button would do anything. */
export function isBudgetBlockedReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return BUDGET_BLOCKED_MARKERS.some((marker) => reason.includes(marker));
}
