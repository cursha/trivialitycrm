import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getAiResearchReport } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { StatTile, MetricBreakdown } from "../report-ui";
import { Card, SectionHeading } from "@/components/ui/card";

export const metadata = { title: "AI Research Reports — Triviality CRM" };

export default async function AiResearchReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const filters = parseReportFilters(rawFiltersFromParams(params));
  const options = await getReportFilterOptions();
  const report = await getAiResearchReport(user, filters);
  if (!report) {
    return <p className="text-text-muted">You do not have access to view reports.</p>;
  }

  const canExport = hasPermission(user, "export_reports");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportFilterBar leadTypes={options.leadTypes} competitors={options.competitors} />
        {canExport && <ExportLinks reportKey="ai-research" />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Searches run" value={report.searchesRun} href="/leads" />
        {report.funnel.map((f) => (
          <StatTile key={f.label} label={f.label} value={f.count} />
        ))}
      </div>

      <MetricBreakdown title="Search status" rows={report.searchStatusBreakdown} emptyLabel="No searches in this range." />
      <MetricBreakdown
        title="Result disposition"
        rows={report.dispositionBreakdown}
        emptyLabel="No results in this range."
      />

      <Card>
        <SectionHeading>Estimated AI cost (in range)</SectionHeading>
        {report.costEstimate === null ? (
          <p className="mt-2 text-sm text-text-muted">
            You do not have the &quot;View AI research costs&quot; permission — ask an Administrator for access.
          </p>
        ) : (
          <>
            <p className="mt-2 text-3xl font-black text-text">${report.costEstimate.totalUsd.toFixed(2)}</p>
            <p className="mt-1 text-xs text-text-muted">
              This is an ESTIMATE, not a bill — {report.costEstimate.totalTokens.toLocaleString()} tokens across{" "}
              {report.costEstimate.callCount} provider call{report.costEstimate.callCount === 1 ? "" : "s"}, priced per
              call using the AI provider&apos;s published per-token rates at the time of the call (pricing assumptions
              documented in <code>src/lib/research/providers/pricing.ts</code> and REPORT_DEFINITIONS.md). Actual
              provider invoices may differ.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
