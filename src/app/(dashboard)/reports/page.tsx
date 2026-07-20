import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getDashboardMetrics } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "./filter-options";
import { ReportFilterBar } from "./report-filter-bar";
import { ExportLinks } from "./export-links";
import { StatTile, MetricBreakdown } from "./report-ui";

export const metadata = { title: "Reports — Triviality CRM" };

export default async function ReportsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const filters = parseReportFilters(rawFiltersFromParams(params));
  const [options, workspaceSettings] = await Promise.all([
    getReportFilterOptions(),
    prisma.workspaceSettings.findUnique({ where: { id: 1 } }),
  ]);
  const metrics = await getDashboardMetrics(user, filters, workspaceSettings?.noActivityThresholdDays ?? 14);

  if (!metrics) {
    return <p className="text-text-muted">You do not have access to view reports.</p>;
  }

  const canViewAiCosts = hasPermission(user, "view_ai_costs");

  const canExport = hasPermission(user, "export_reports");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportFilterBar
          leadTypes={options.leadTypes}
          pipelineStages={options.pipelineStages}
          salespeople={options.salespeople}
          competitors={options.competitors}
          territories={options.territories}
          showSource
          showStatus
          showTriviaStatus
          showScoreRange
        />
        {canExport && <ExportLinks reportKey="dashboard" />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="New leads" value={metrics.newLeads} href="/companies" />
        <StatTile label="Active leads" value={metrics.activeLeads} href="/companies" />
        <StatTile label="Unassigned leads" value={metrics.unassignedLeads} href="/pipeline?view=unassigned" />
        <StatTile label="Archived (in range)" value={metrics.archivedInRange} />
        <StatTile label="Overdue follow-ups" value={metrics.overdueFollowUps} href="/pipeline?view=overdue" />
        <StatTile label="Follow-ups created" value={metrics.followUpsCreated} href="/follow-ups" />
        <StatTile label="Activities completed" value={metrics.activitiesCompleted} />
        <StatTile label="No recent activity" value={metrics.noRecentActivity} />
        <StatTile label="Active trials" value={metrics.activeTrials} />
        <StatTile label="Won (in range)" value={metrics.wonInRange} href="/pipeline?view=won" />
        <StatTile label="Lost (in range)" value={metrics.lostInRange} href="/pipeline?view=lost" />
        <StatTile label="Competitor-linked leads" value={metrics.competitorLinked} href="/competitors" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Manual leads (in range)" value={metrics.manualLeads} />
        <StatTile label="AI-transferred leads (in range)" value={metrics.aiLeads} />
        <StatTile label="Imported leads (in range)" value={metrics.importedLeads} />
        <StatTile label="AI searches run (in range)" value={metrics.aiSearchesRun} href="/leads" />
        <StatTile label="AI candidates discovered (in range)" value={metrics.aiCandidatesDiscovered} />
      </div>
      {!canViewAiCosts && (
        <p className="text-xs text-text-muted">AI cost estimates require the &quot;View AI research costs&quot; permission.</p>
      )}

      <MetricBreakdown
        title="Current pipeline"
        rows={metrics.pipelineBreakdown.map((s) => ({ label: s.stageName, count: s.count, href: `/companies?pipelineStageId=${s.stageId}` }))}
        emptyLabel="No active companies yet."
        countLabel="Companies"
      />
    </div>
  );
}
