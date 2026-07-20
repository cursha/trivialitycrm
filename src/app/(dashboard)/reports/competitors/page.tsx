import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { parseReportFilters } from "@/lib/reports/filters";
import { getCompetitorsReport } from "./queries";
import { getReportFilterOptions, rawFiltersFromParams } from "../filter-options";
import { ReportFilterBar } from "../report-filter-bar";
import { ExportLinks } from "../export-links";
import { Card, SectionHeading } from "@/components/ui/card";
import { NoDataNote } from "../report-ui";

export const metadata = { title: "Competitor Reports — Triviality CRM" };

export default async function CompetitorsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const filters = parseReportFilters(rawFiltersFromParams(params));
  const options = await getReportFilterOptions();
  const report = await getCompetitorsReport(user, filters);
  if (!report) {
    return <p className="text-text-muted">You do not have access to view reports.</p>;
  }
  if (report.forbidden) {
    return <p className="text-text-muted">You do not have the &quot;View competitor reports&quot; permission.</p>;
  }

  const canExport = hasPermission(user, "export_reports");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReportFilterBar
          leadTypes={options.leadTypes}
          pipelineStages={options.pipelineStages}
          salespeople={options.salespeople}
          territories={options.territories}
          showSource
          showStatus
        />
        {canExport && <ExportLinks reportKey="competitors" />}
      </div>

      <Card>
        <SectionHeading>Competitors (computed from linked leads)</SectionHeading>
        {report.rows.length === 0 ? (
          <NoDataNote>No active competitors configured.</NoDataNote>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th scope="col" className="pb-2">
                    Competitor
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Linked active leads
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
                  <tr key={row.competitorId} className="border-t border-border/40">
                    <td className="py-2 font-medium text-text">{row.name}</td>
                    <td className="py-2 text-right">
                      <Link href={`/companies?competitorId=${row.competitorId}`} className="text-secondary hover:underline">
                        {row.linkedLeads}
                      </Link>
                    </td>
                    <td className="py-2 text-right text-text">{row.wonInRange}</td>
                    <td className="py-2 text-right text-text">{row.lostInRange}</td>
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
