import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Competition Locator History — Triviality CRM" };

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

// Bounded to the most recent 500 child LeadSearch rows (roughly 8 broad,
// all-region runs) — a search-history index viewed occasionally, not a hot
// path; full per-run detail is one click away via the review page, which
// queries only that one run's rows.
const MAX_CHILD_SEARCHES = 500;

export default async function CompetitionLocatorHistoryPage() {
  const user = await requireUser();
  requirePermission(user, "review_research_results");

  const searches = await prisma.leadSearch.findMany({
    where: { runCorrelationId: { not: null }, mode: "COMPETITOR" },
    include: { competitor: true, createdBy: true },
    orderBy: { createdAt: "desc" },
    take: MAX_CHILD_SEARCHES,
  });

  type RunSummary = {
    runId: string;
    competitorId: string | null;
    competitorName: string;
    createdByName: string;
    regionCount: number;
    completedCount: number;
    failedCount: number;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
  };

  const runsById = new Map<string, RunSummary>();

  for (const search of searches) {
    const runId = search.runCorrelationId!;
    const existing = runsById.get(runId);
    if (!existing) {
      runsById.set(runId, {
        runId,
        competitorId: search.competitorId,
        competitorName: search.competitor?.name ?? "Unknown competitor",
        createdByName: search.createdBy.name,
        regionCount: 1,
        completedCount: TERMINAL.has(search.status) ? 1 : 0,
        failedCount: search.status === "FAILED" ? 1 : 0,
        startedAt: search.startedAt,
        completedAt: search.completedAt,
        createdAt: search.createdAt,
      });
    } else {
      existing.regionCount += 1;
      if (TERMINAL.has(search.status)) existing.completedCount += 1;
      if (search.status === "FAILED") existing.failedCount += 1;
      if (search.startedAt && (!existing.startedAt || search.startedAt < existing.startedAt)) existing.startedAt = search.startedAt;
      if (search.completedAt && (!existing.completedAt || search.completedAt > existing.completedAt)) existing.completedAt = search.completedAt;
      if (search.createdAt > existing.createdAt) existing.createdAt = search.createdAt;
    }
  }

  const byCompetitor = new Map<string, { competitorName: string; runs: RunSummary[] }>();
  for (const run of runsById.values()) {
    const key = run.competitorId ?? run.competitorName;
    const group = byCompetitor.get(key) ?? { competitorName: run.competitorName, runs: [] };
    group.runs.push(run);
    byCompetitor.set(key, group);
  }
  const competitorGroups = Array.from(byCompetitor.values())
    .map((group) => ({ ...group, runs: group.runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) }))
    .sort((a, b) => a.competitorName.localeCompare(b.competitorName));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Competition Locator History"
        description="Past Competition Locator runs, organized by competitor."
        actions={
          <Link href="/leads/competition-locator" className="text-sm font-semibold text-secondary hover:underline">
            New search
          </Link>
        }
      />

      {competitorGroups.length === 0 && (
        <Card>
          <p className="text-sm text-text-muted">No Competition Locator runs yet.</p>
        </Card>
      )}

      {competitorGroups.map((group) => (
        <Card key={group.competitorName} className="space-y-3">
          <SectionHeading>{group.competitorName}</SectionHeading>
          <div className="space-y-2">
            {group.runs.map((run) => {
              const allComplete = run.completedCount === run.regionCount;
              return (
                <Link
                  key={run.runId}
                  href={run.regionCount > 0 && allComplete ? `/leads/competition-locator/${run.runId}/review` : `/leads/competition-locator/${run.runId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 hover:bg-black/5"
                >
                  <div>
                    <p className="text-sm font-semibold text-text">
                      {run.regionCount} region{run.regionCount === 1 ? "" : "s"} · started by {run.createdByName}
                    </p>
                    <p className="text-xs text-text-muted">
                      {run.startedAt ? run.startedAt.toLocaleString() : "Not started"}
                      {run.completedAt ? ` — ${run.completedAt.toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {run.failedCount > 0 && <Badge tone="danger">{run.failedCount} failed</Badge>}
                    <Badge tone={allComplete ? "success" : "focus"}>
                      {run.completedCount}/{run.regionCount} complete
                    </Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
