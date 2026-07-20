import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getManagerWorkspaceData } from "./queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Manager Workspace — Triviality CRM" };

export default async function ManagerWorkspacePage() {
  const user = await requireUser();
  requirePermission(user, "view_manager_workspace");

  const data = await getManagerWorkspaceData(user);
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Manager Workspace" />
        <p className="mt-2 text-text-muted">No lead-viewing permission is configured for your role.</p>
      </div>
    );
  }

  const { stats, unassignedCount, overdueBySalesperson, activeTrialsCount, recentlyResolved, territoryCoverage } = data;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Manager Workspace"
        description="Operational overview of your team's pipeline. For conversion trends and reporting, see Module Five."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-sm font-semibold text-text-muted">Active leads</p>
          <p className="mt-2 text-3xl font-bold text-text">{stats.activeLeads}</p>
        </Card>
        <Card>
          <p className="text-sm font-semibold text-text-muted">Unassigned leads</p>
          <p className="mt-2 text-3xl font-bold text-text">{unassignedCount}</p>
          <Link href="/pipeline?view=unassigned" className="mt-1 inline-block text-xs font-semibold text-secondary hover:underline">
            View unassigned
          </Link>
        </Card>
        <Card>
          <p className="text-sm font-semibold text-text-muted">Overdue follow-ups</p>
          <p className="mt-2 text-3xl font-bold text-danger">{stats.followUpsOverdue}</p>
          <Link href="/pipeline?view=overdue" className="mt-1 inline-block text-xs font-semibold text-secondary hover:underline">
            View overdue
          </Link>
        </Card>
        <Card>
          <p className="text-sm font-semibold text-text-muted">Active trials</p>
          <p className="mt-2 text-3xl font-bold text-text">{activeTrialsCount}</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeading>Workload by salesperson</SectionHeading>
          {stats.salespeopleBreakdown.length === 0 ? (
            <EmptyState>No active companies yet.</EmptyState>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs uppercase text-text-muted">
                <tr>
                  <th className="py-2">Salesperson</th>
                  <th className="py-2">Active leads</th>
                  <th className="py-2">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {stats.salespeopleBreakdown.map((row) => (
                  <tr key={row.userId ?? "unassigned"} className="border-t border-border">
                    <td className="py-2 text-text">{row.userName}</td>
                    <td className="py-2 text-text">{row.count}</td>
                    <td className="py-2">
                      {(() => {
                        const overdue = overdueBySalesperson.find((o) => o.userId === row.userId)?.count ?? 0;
                        return overdue > 0 ? <Badge tone="danger">{overdue}</Badge> : <span className="text-text-muted">0</span>;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <SectionHeading>Pipeline stage counts</SectionHeading>
          {stats.pipelineBreakdown.length === 0 ? (
            <EmptyState>No active companies yet.</EmptyState>
          ) : (
            <div className="mt-3 space-y-2">
              {stats.pipelineBreakdown.map((stage) => (
                <div key={stage.stageId} className="flex items-center justify-between text-sm">
                  <span className="text-text">{stage.stageName}</span>
                  <span className="font-semibold text-text">{stage.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeading>Recently won &amp; lost</SectionHeading>
          {recentlyResolved.length === 0 ? (
            <EmptyState>Nothing resolved yet.</EmptyState>
          ) : (
            <ul className="mt-3 space-y-2">
              {recentlyResolved.map((company) => (
                <li key={company.id} className="flex items-center justify-between text-sm">
                  <Link href={`/companies/${company.id}`} className="font-semibold text-secondary hover:underline">
                    {company.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge tone={company.outcomeType === "WON" ? "success" : "danger"}>{company.stageName}</Badge>
                    <span className="text-xs text-text-muted">{company.assignedToName}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeading>Territory coverage</SectionHeading>
          {territoryCoverage.length === 0 ? (
            <EmptyState>No territories configured yet.</EmptyState>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs uppercase text-text-muted">
                <tr>
                  <th className="py-2">Territory</th>
                  <th className="py-2">Owner</th>
                  <th className="py-2">Companies</th>
                </tr>
              </thead>
              <tbody>
                {territoryCoverage.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2 text-text">{t.name}</td>
                    <td className="py-2 text-text-muted">{t.assignedToName ?? "Unassigned"}</td>
                    <td className="py-2 text-text">{t.companyCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <SectionHeading>Reassign leads</SectionHeading>
          <Link href="/pipeline?view=team" className="text-sm font-semibold text-secondary hover:underline">
            Open Team Leads to bulk-reassign
          </Link>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Select companies in the Team Leads view and use the bulk-action toolbar to reassign or set a territory owner.
        </p>
      </Card>
    </div>
  );
}
