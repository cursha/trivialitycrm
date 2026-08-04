"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { cancelSearch } from "@/app/(dashboard)/leads/searches/actions";

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
