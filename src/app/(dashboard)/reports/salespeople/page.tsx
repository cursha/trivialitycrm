import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getSalespeopleReport } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { Card, SectionHeading } from "@/components/ui/card";
import { NoDataNote } from "../report-ui";

export const metadata = { title: "Salesperson Reports — Triviality CRM" };

export default async function SalespeopleReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const filters = parseReportFilters(rawFiltersFromParams(params));
  const options = await getReportFilterOptions();
  const report = await getSalespeopleReport(user, filters);
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
        />
        {canExport && <ExportLinks reportKey="salespeople" />}
      </div>

      <Card>
        <SectionHeading>Salesperson performance (in range)</SectionHeading>
        <p className="mt-1 text-xs text-text-muted">
          Four separate measures, shown side by side rather than blended into one score — high activity with no
          pipeline progress is a signal worth seeing on its own, not something an average would hide.
        </p>
        {report.rows.length === 0 ? (
          <NoDataNote>No salespeople in scope.</NoDataNote>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th scope="col" className="pb-2">
                    Salesperson
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Activity completed
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Pipeline progress
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Won
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Lost
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Current workload
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.userId} className="border-t border-border/40">
                    <td className="py-2 font-medium text-text">{row.name}</td>
                    <td className="py-2 text-right text-text">{row.activitiesCompleted}</td>
                    <td className="py-2 text-right text-text">{row.pipelineProgress}</td>
                    <td className="py-2 text-right text-text">{row.won}</td>
                    <td className="py-2 text-right text-text">{row.lost}</td>
                    <td className="py-2 text-right text-text-muted">{row.currentWorkload}</td>
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
