"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { cancelSearch, retrySearchWithBudgetOverride } from "@/app/(dashboard)/leads/searches/actions";

/**
 * Fans out to the existing, unmodified cancelSearch() (leads/searches/actions.ts)
 * for every non-terminal child LeadSearch sharing this run — no cancellation
 * logic is reimplemented here, only the fan-out across regions.
 */
export async function cancelCompetitionLocatorRun(runId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  requirePermission(user, "run_competition_locator");

  const searches = await prisma.leadSearch.findMany({
    where: { runCorrelationId: runId, status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true },
  });

  for (const search of searches) {
    await cancelSearch(search.id);
  }

  return {};
}

/**
 * Fans out to retrySearchWithBudgetOverride() for every FAILED child
 * LeadSearch in this run — a multi-region run can have several regions
 * stuck on the same global daily/monthly budget wall, not just one, so
 * resuming the whole run means resuming all of them, not just the first.
 * Same run_research-gating caveat as cancelCompetitionLocatorRun above:
 * retrySearchWithBudgetOverride requires run_research (its own permission),
 * not run_competition_locator — fine today since only Administrator holds
 * either, but would need its own gate if that ever diverges.
 */
export async function retryCompetitionLocatorRunWithOverride(runId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  requirePermission(user, "run_competition_locator");
  requirePermission(user, "manage_ai_settings");

  const searches = await prisma.leadSearch.findMany({
    where: { runCorrelationId: runId, status: "FAILED" },
    select: { id: true },
  });

  for (const search of searches) {
    const result = await retrySearchWithBudgetOverride(search.id);
    if (result.error) return result;
  }

  return {};
}
