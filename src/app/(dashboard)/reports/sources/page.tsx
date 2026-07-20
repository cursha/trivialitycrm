import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getSourcesReport } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { MetricBreakdown, RateStat } from "../report-ui";
import { Card, SectionHeading } from "@/components/ui/card";

export const metadata = { title: "Lead Source Reports — Triviality CRM" };

export default async function SourcesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const filters = parseReportFilters(rawFiltersFromParams(params));
  const options = await getReportFilterOptions();
  const report = await getSourcesReport(user, filters);
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
        />
        {canExport && <ExportLinks reportKey="sources" />}
      </div>

      <MetricBreakdown title="Leads by source (in range)" rows={report.rows} emptyLabel="No leads created in this range." />

      <Card>
        <SectionHeading>Win rate by source (in range)</SectionHeading>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {report.winRateBySource.map((r) => (
            <RateStat key={r.label} label={r.label} result={r.result} />
          ))}
        </div>
      </Card>
    </div>
  );
}
