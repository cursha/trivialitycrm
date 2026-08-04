import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

/**
 * Aggregates every child LeadSearch (one per region) sharing a
 * runCorrelationId into one status payload — the polling analog of
 * /api/searches/[id]/status/route.ts, but for a whole Competition Locator
 * run instead of a single search. "needsReview" maps to BELOW_SCORE
 * dispositions (scored but under the search's minimumScore) — the
 * genuinely-borderline set a human should look at, distinct from the
 * review screen's 5 approve/reject buckets.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await requireUser();
  requirePermission(user, "run_competition_locator");
  const { runId } = await params;

  const searches = await prisma.leadSearch.findMany({
    where: { runCorrelationId: runId },
    select: { status: true, errorMessage: true },
  });

  if (searches.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const totalRegions = searches.length;
  const completedRegions = searches.filter((s) => TERMINAL.has(s.status)).length;
  const allTerminal = completedRegions === totalRegions;
  const anyFailed = searches.some((s) => s.status === "FAILED");
  const anyRunning = searches.some((s) => s.status === "RUNNING" || s.status === "PENDING");
  const errors = Array.from(new Set(searches.filter((s) => s.status === "FAILED" && s.errorMessage).map((s) => s.errorMessage as string)));

  const [resultCounts, possibleDuplicates] = await Promise.all([
    prisma.searchResult.groupBy({ by: ["disposition"], where: { search: { runCorrelationId: runId } }, _count: true }),
    prisma.searchResult.count({ where: { search: { runCorrelationId: runId }, duplicateConfidence: { not: null } } }),
  ]);

  const countFor = (disposition: string) => resultCounts.find((r) => r.disposition === disposition)?._count ?? 0;
  const found = resultCounts.reduce((sum, r) => sum + r._count, 0);
  const rejected = countFor("REJECTED");
  const needsReview = countFor("BELOW_SCORE");
  const verified = found - rejected;

  const status = !allTerminal ? "RUNNING" : anyFailed ? "PARTIAL_FAILURE" : anyRunning ? "RUNNING" : "SUCCEEDED";

  return NextResponse.json({
    status,
    totalRegions,
    completedRegions,
    found,
    verified,
    rejected,
    needsReview,
    possibleDuplicates,
    errors,
  });
}
