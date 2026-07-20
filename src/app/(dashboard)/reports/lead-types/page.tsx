import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getLeadTypesReport } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { MetricBreakdown, RateStat } from "../report-ui";
import { Card, SectionHeading } from "@/components/ui/card";
import { NoDataNote } from "../report-ui";

export const metadata = { title: "Lead Type Reports — Triviality CRM" };

export default async function LeadTypesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const filters = parseReportFilters(rawFiltersFromParams(params));
  const options = await getReportFilterOptions();
  const report = await getLeadTypesReport(user, filters);
  if (!report) {
    return <p className="text-text-muted">You do not have access to view reports.</p>;
  }

  const canExport = hasPermission(user, "export_reports");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportFilterBar
          pipelineStages={options.pipelineStages}
          salespeople={options.salespeople}
          competitors={options.competitors}
          territories={options.territories}
          showSource
          showStatus
          showOutcome
        />
        {canExport && <ExportLinks reportKey="lead-types" />}
      </div>

      <MetricBreakdown title="Active leads by lead type" rows={report.rows.map((r) => ({ label: r.label, count: r.count }))} emptyLabel="No lead types configured." />

      <Card>
        <SectionHeading>Win rate by lead type (in range)</SectionHeading>
        {report.winRateByLeadType.length === 0 ? (
          <NoDataNote>No lead types configured.</NoDataNote>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {report.winRateByLeadType.map((r) => (
              <RateStat key={r.label} label={r.label} result={r.result} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
