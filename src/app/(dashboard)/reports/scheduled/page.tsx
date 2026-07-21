import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { REPORT_KEYS, REPORT_LABELS } from "@/lib/reports/build-rows";
import { Card, SectionHeading } from "@/components/ui/card";
import { NoDataNote } from "../report-ui";
import { ScheduledReportForm } from "./scheduled-report-form";
import { ScheduledReportRow } from "./scheduled-report-row";

export const metadata = { title: "Scheduled Reports — Triviality CRM" };

export default async function ScheduledReportsPage() {
  const user = await requireUser();
  requirePermission(user, "manage_scheduled_reports");

  const [schedules, salespeople, recentRuns] = await Promise.all([
    prisma.scheduledReport.findMany({ orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true } } } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.generatedReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { scheduledReport: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading>New scheduled report</SectionHeading>
        <p className="mt-1 text-xs text-text-muted">
          Runs on the durable worker (Module Three) — a daily/weekly/monthly cadence generates the report for that
          period and stores it as a downloadable record. Nothing is emailed yet; recipients see it via the
          notification bell.
        </p>
        <div className="mt-4">
          <ScheduledReportForm reportOptions={REPORT_KEYS.map((key) => ({ key, label: REPORT_LABELS[key] }))} salespeople={salespeople} />
        </div>
      </Card>

      <Card>
        <SectionHeading>Schedules</SectionHeading>
        {schedules.length === 0 ? (
          <NoDataNote>No scheduled reports yet.</NoDataNote>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th scope="col" className="pb-2">
                    Name
                  </th>
                  <th scope="col" className="pb-2">
                    Report
                  </th>
                  <th scope="col" className="pb-2">
                    Cadence
                  </th>
                  <th scope="col" className="pb-2">
                    Recipients
                  </th>
                  <th scope="col" className="pb-2">
                    Last run
                  </th>
                  <th scope="col" className="pb-2">
                    Next run
                  </th>
                  <th scope="col" className="pb-2">
                    Active
                  </th>
                  <th scope="col" className="pb-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <ScheduledReportRow
                    key={s.id}
                    schedule={{
                      id: s.id,
                      name: s.name,
                      reportLabel: REPORT_LABELS[s.reportKey as keyof typeof REPORT_LABELS] ?? s.reportKey,
                      cadence: s.cadence,
                      recipientCount: s.recipientIds.length,
                      lastRunAt: s.lastRunAt?.toISOString() ?? null,
                      lastRunStatus: s.lastRunStatus,
                      nextRunAt: s.nextRunAt.toISOString(),
                      active: s.active,
                      createdByName: s.createdBy.name,
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionHeading>Recent runs</SectionHeading>
        {recentRuns.length === 0 ? (
          <NoDataNote>No reports generated yet.</NoDataNote>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th scope="col" className="pb-2">
                    Schedule
                  </th>
                  <th scope="col" className="pb-2">
                    Status
                  </th>
                  <th scope="col" className="pb-2">
                    Generated
                  </th>
                  <th scope="col" className="pb-2">
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id} className="border-t border-border/40">
                    <td className="py-2 font-medium text-text">{run.scheduledReport?.name ?? "(schedule deleted)"}</td>
                    <td className="py-2 text-text">{run.status}</td>
                    <td className="py-2 text-text-muted">{run.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td className="py-2 text-right">
                      {run.status === "SUCCEEDED" && (
                        <a href={`/api/reports/generated/${run.id}/download?format=csv`} className="text-secondary hover:underline">
                          Download CSV
                        </a>
                      )}
                      {run.status === "FAILED" && <span className="text-xs text-danger">{run.errorMessage}</span>}
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
