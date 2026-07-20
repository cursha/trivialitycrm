import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getPipelineReport } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { StatTile, MetricBreakdown, RateStat, NoDataNote } from "../report-ui";
import { Card, SectionHeading } from "@/components/ui/card";

export const metadata = { title: "Pipeline Reports — Triviality CRM" };

export default async function PipelineReportPage({
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
  const report = await getPipelineReport(user, filters, workspaceSettings?.noActivityThresholdDays ?? 14);

  if (!report) {
    return <p className="text-text-muted">You do not have access to view reports.</p>;
  }

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
          showOutcome
          showTriviaStatus
          showScoreRange
        />
        {canExport && <ExportLinks reportKey="pipeline" />}
      </div>

      <MetricBreakdown
        title="Current pipeline"
        rows={report.currentPipelineBreakdown.map((s) => ({ label: s.stageName, count: s.count, href: `/companies?pipelineStageId=${s.stageId}` }))}
        emptyLabel="No active companies yet."
        countLabel="Companies"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricBreakdown
          title="Entries into stage (in range)"
          rows={report.entriesByStage.map((s) => ({ label: s.stageName, count: s.count }))}
          emptyLabel="No stage changes in this range."
        />
        <MetricBreakdown
          title="Exits from stage (in range)"
          rows={report.exitsByStage.map((s) => ({ label: s.stageName, count: s.count }))}
          emptyLabel="No stage changes in this range."
        />
      </div>

      <Card>
        <SectionHeading>Average days in stage</SectionHeading>
        {report.avgDaysByStage.length === 0 ? (
          <NoDataNote>Not tracked before Module Five shipped — no stage-history rows exist yet.</NoDataNote>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th scope="col" className="pb-2">
                    Stage
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Avg days
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Visits
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.avgDaysByStage.map((row) => (
                  <tr key={row.stageId} className="border-t border-border/40">
                    <td className="py-2 font-medium text-text">{row.stageName}</td>
                    <td className="py-2 text-right text-text">{row.avgDays}</td>
                    <td className="py-2 text-right text-text-muted">{row.visitCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Stalled leads" value={report.stalledCount} href="/pipeline" />
        {report.stalledUntracked > 0 && (
          <Card>
            <p className="text-sm font-semibold text-text-muted">Stalled — not tracked</p>
            <p className="mt-2 text-xs text-text-muted">
              {report.stalledUntracked} active companies have no stage-history row for their current stage (created or
              last moved before Module Five shipped) — excluded rather than guessed.
            </p>
          </Card>
        )}
        <RateStat label="New → Won (cohort)" result={report.newToWonRate} />
      </div>

      <MetricBreakdown
        title="Loss reasons (in range)"
        rows={report.lossReasonBreakdown}
        emptyLabel="No leads lost in this range."
      />

      <Card>
        <SectionHeading>Stage-to-stage conversion (all-time, in scope)</SectionHeading>
        <p className="mt-1 text-xs text-text-muted">
          Share of companies that ever reached the first stage who also ever reached the next — co-occurrence, not a
          strict same-cohort sequence.
        </p>
        {report.stageConversions.length === 0 ? (
          <NoDataNote>No pipeline stages configured yet.</NoDataNote>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {report.stageConversions.map((c) => (
              <RateStat key={`${c.from}-${c.to}`} label={`${c.from} → ${c.to}`} result={c.result} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <SectionHeading>Win rate by lead type (in range)</SectionHeading>
          <div className="mt-3 space-y-2">
            {report.winRateByLeadType.length === 0 ? (
              <NoDataNote>No decided leads in this range.</NoDataNote>
            ) : (
              report.winRateByLeadType.map((r) => <RateStat key={r.label} label={r.label} result={r.result} />)
            )}
          </div>
        </Card>
        <Card>
          <SectionHeading>Win rate by source (in range)</SectionHeading>
          <div className="mt-3 space-y-2">
            {report.winRateBySource.length === 0 ? (
              <NoDataNote>No decided leads in this range.</NoDataNote>
            ) : (
              report.winRateBySource.map((r) => <RateStat key={r.label} label={r.label} result={r.result} />)
            )}
          </div>
        </Card>
        <Card>
          <SectionHeading>Win rate by salesperson (in range)</SectionHeading>
          <div className="mt-3 space-y-2">
            {report.winRateBySalesperson.length === 0 ? (
              <NoDataNote>No decided leads in this range.</NoDataNote>
            ) : (
              report.winRateBySalesperson.map((r) => <RateStat key={r.label} label={r.label} result={r.result} />)
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
