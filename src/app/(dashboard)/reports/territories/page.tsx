import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getTerritoriesReport } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { Card, SectionHeading } from "@/components/ui/card";
import { NoDataNote } from "../report-ui";

export const metadata = { title: "Territory Reports — Triviality CRM" };

export default async function TerritoriesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const filters = parseReportFilters(rawFiltersFromParams(params));
  const options = await getReportFilterOptions();
  const report = await getTerritoriesReport(user, filters);
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
          showSource
          showStatus
          showOutcome
        />
        {canExport && <ExportLinks reportKey="territories" />}
      </div>

      <Card>
        <SectionHeading>Territory coverage</SectionHeading>
        {report.rows.length === 0 ? (
          <NoDataNote>No active territories configured.</NoDataNote>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th scope="col" className="pb-2">
                    Territory
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Active leads
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Won (in range)
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Lost (in range)
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.territoryId} className="border-t border-border/40">
                    <td className="py-2 font-medium text-text">{row.name}</td>
                    <td className="py-2 text-right">
                      {row.leadCount === 0 ? (
                        <span className="italic text-text-muted">No recorded leads</span>
                      ) : (
                        <Link href={`/pipeline?territoryId=${row.territoryId}`} className="text-secondary hover:underline">
                          {row.leadCount}
                        </Link>
                      )}
                    </td>
                    <td className="py-2 text-right text-text">{row.wonInRange}</td>
                    <td className="py-2 text-right text-text">{row.lostInRange}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.unmatched > 0 && (
          <p className="mt-3 text-xs text-text-muted">
            {report.unmatched} active {report.unmatched === 1 ? "lead is" : "leads are"} in scope but not yet
            researched into any configured territory.
          </p>
        )}
      </Card>
    </div>
  );
}
