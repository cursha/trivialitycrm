import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { RunStatus } from "./run-status";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Competition Locator Run — Triviality CRM" };

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export default async function CompetitionLocatorRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireUser();
  requirePermission(user, "run_competition_locator");
  const { runId } = await params;

  const searches = await prisma.leadSearch.findMany({
    where: { runCorrelationId: runId },
    include: { competitor: true },
  });
  if (searches.length === 0) notFound();

  const [{ competitor }] = searches;
  const totalRegions = searches.length;
  const completedRegions = searches.filter((s) => TERMINAL.has(s.status)).length;
  const anyFailed = searches.some((s) => s.status === "FAILED");
  const anyRunning = searches.some((s) => s.status === "RUNNING" || s.status === "PENDING");
  const allTerminal = completedRegions === totalRegions;
  const status = !allTerminal ? "RUNNING" : anyFailed ? "PARTIAL_FAILURE" : anyRunning ? "RUNNING" : "SUCCEEDED";
  const errors = Array.from(new Set(searches.filter((s) => s.status === "FAILED" && s.errorMessage).map((s) => s.errorMessage as string)));

  const [resultCounts, possibleDuplicates] = await Promise.all([
    prisma.searchResult.groupBy({ by: ["disposition"], where: { search: { runCorrelationId: runId } }, _count: true }),
    prisma.searchResult.count({ where: { search: { runCorrelationId: runId }, duplicateConfidence: { not: null } } }),
  ]);
  const countFor = (disposition: string) => resultCounts.find((r) => r.disposition === disposition)?._count ?? 0;
  const found = resultCounts.reduce((sum, r) => sum + r._count, 0);
  const rejected = countFor("REJECTED");

  // Same "at most one region genuinely RUNNING" reasoning as the polling
  // status route — this is just its first-paint equivalent.
  const activeSearch = searches
    .filter((s) => s.status === "RUNNING")
    .sort((a, b) => (b.heartbeatAt?.getTime() ?? 0) - (a.heartbeatAt?.getTime() ?? 0))[0];
  const currentActivity = activeSearch
    ? { region: activeSearch.region, country: activeSearch.country, message: activeSearch.progressMessage }
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={`Competition Locator: ${competitor?.name ?? "Unknown competitor"}`} description={`Searching ${totalRegions} region${totalRegions === 1 ? "" : "s"}.`} />
      <RunStatus
        runId={runId}
        initial={{
          status,
          totalRegions,
          completedRegions,
          found,
          verified: found - rejected,
          rejected,
          needsReview: countFor("BELOW_SCORE"),
          possibleDuplicates,
          errors,
          currentActivity,
        }}
      />
    </div>
  );
}
