import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getTrendsReport } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { Card, SectionHeading } from "@/components/ui/card";
import { NoDataNote } from "../report-ui";

export const metadata = { title: "Time and Trend Reports — Triviality CRM" };

function formatWeek(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default async function TrendsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const raw = rawFiltersFromParams(params);
  // Trends defaults to a wider window than other reports (quarter, not
  // month) since a single week of data makes for an uninteresting trend —
  // only applied when the user hasn't picked a range explicitly.
  if (!params.dateRange) raw.dateRange = "quarter";
  const filters = parseReportFilters(raw);
  const options = await getReportFilterOptions();
  const report = await getTrendsReport(user, filters);
  if (!report) {
    return <p className="text-text-muted">You do not have access to view reports.</p>;
  }

  const maxValue = Math.max(1, ...report.rows.flatMap((r) => [r.newLeads, r.won, r.lost, r.activities]));

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
        />
        {canExport && <ExportLinks reportKey="trends" />}
      </div>

      <Card>
        <SectionHeading>Weekly trends</SectionHeading>
        <p className="mt-1 text-xs text-text-muted">Weeks start Monday, America/Toronto. A week with no activity shows as 0, not a gap.</p>
        {report.rows.length === 0 ? (
          <NoDataNote>No weeks in this range.</NoDataNote>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th scope="col" className="pb-2">
                    Week of
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    New leads
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Won
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Lost
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Activities
                  </th>
                  <th scope="col" className="pb-2">
                    <span className="sr-only">Relative scale</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.weekStart.toISOString()} className="border-t border-border/40">
                    <td className="py-2 font-medium text-text">{formatWeek(row.weekStart)}</td>
                    <td className="py-2 text-right text-text">{row.newLeads}</td>
                    <td className="py-2 text-right text-text">{row.won}</td>
                    <td className="py-2 text-right text-text">{row.lost}</td>
                    <td className="py-2 text-right text-text">{row.activities}</td>
                    <td className="py-2 pl-2">
                      <div className="h-1.5 w-24 rounded-full bg-border/40">
                        <div
                          className="h-1.5 rounded-full bg-secondary"
                          style={{ width: `${(row.activities / maxValue) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
