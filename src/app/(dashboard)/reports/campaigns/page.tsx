import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { salesListVisibilityWhere } from "@/lib/sales-lists/scope";
import { getCampaignsForReport, getCampaignOutcomeBreakdown } from "./queries";
import { CampaignReportFilters, type CampaignReportCurrentFilters } from "./campaign-report-filters";
import { Card, SectionHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CAMPAIGN_STATUS_TONE, humanizeEnum } from "@/lib/ui/status-tones";

export const metadata = { title: "Campaign Reports — Triviality CRM" };

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function BreakdownTable({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  return (
    <Card>
      <SectionHeading>{title}</SectionHeading>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No data for the current filters.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between">
              <span className="text-text">{row.label}</span>
              <span className="font-semibold text-text-muted">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default async function CampaignReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  requirePermission(user, "view_campaign_reports");
  const params = await searchParams;

  const filters: CampaignReportCurrentFilters = {
    listId: toSingle(params.listId),
    status: toSingle(params.status),
    senderId: toSingle(params.senderId),
    outcome: toSingle(params.outcome),
    createdFrom: toSingle(params.createdFrom),
    createdTo: toSingle(params.createdTo),
  };

  const listScope = salesListVisibilityWhere(user);
  const [campaigns, breakdown, lists, senders] = await Promise.all([
    getCampaignsForReport(user, filters),
    getCampaignOutcomeBreakdown(user, filters),
    listScope ? prisma.salesList.findMany({ where: { ...listScope, purpose: "EMAIL_CAMPAIGN" }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    prisma.user.findMany({ where: { campaignsAsSender: { some: {} } }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <CampaignReportFilters
        lists={lists.map((l) => ({ id: l.id, name: l.name }))}
        senders={senders.map((s) => ({ id: s.id, name: s.name }))}
        currentFilters={filters}
      />

      <Card className="overflow-hidden p-0">
        <div className="p-5 pb-0">
          <SectionHeading>Campaigns</SectionHeading>
        </div>
        {campaigns.length === 0 ? (
          <div className="p-5">
            <EmptyState>No campaigns match these filters.</EmptyState>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="mt-3 w-full text-left text-sm">
                <thead className="bg-black/5 text-xs uppercase text-text-muted">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">List</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Sender</th>
                    <th className="px-5 py-3">Recipients</th>
                    <th className="px-5 py-3">Sent</th>
                    <th className="px-5 py-3">Failed</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id} className="border-t border-border hover:bg-black/5">
                      <td className="px-5 py-4">
                        <Link href={`/campaigns/${campaign.id}`} className="font-bold text-secondary hover:underline">
                          {campaign.name}
                        </Link>
                      </td>
                      <td className="px-5 py-4">{campaign.list.name}</td>
                      <td className="px-5 py-4">
                        <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status] ?? "neutral"}>{humanizeEnum(campaign.status)}</Badge>
                      </td>
                      <td className="px-5 py-4">{campaign.sender?.name ?? "—"}</td>
                      <td className="px-5 py-4">{campaign._count.recipients}</td>
                      <td className="px-5 py-4">{campaign.sentCount}</td>
                      <td className="px-5 py-4">{campaign.failedCount}</td>
                      <td className="px-5 py-4">{new Date(campaign.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-3 divide-y divide-border md:hidden">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/campaigns/${campaign.id}`} className="font-bold text-secondary hover:underline">
                        {campaign.name}
                      </Link>
                      <p className="text-xs text-text-muted">{campaign.list.name}</p>
                    </div>
                    <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status] ?? "neutral"}>{humanizeEnum(campaign.status)}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-text-muted">Sender</dt>
                      <dd className="font-medium text-text">{campaign.sender?.name ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Recipients</dt>
                      <dd className="font-medium text-text">{campaign._count.recipients}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Sent</dt>
                      <dd className="font-medium text-text">{campaign.sentCount}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Failed</dt>
                      <dd className="font-medium text-text">{campaign.failedCount}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-text-muted">Created {new Date(campaign.createdAt).toLocaleDateString()}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BreakdownTable title="By outcome" rows={breakdown.byOutcome.map((r) => ({ ...r, label: humanizeEnum(r.label) }))} />
        <BreakdownTable title="By lead type" rows={breakdown.byLeadType} />
        <BreakdownTable title="By pipeline stage" rows={breakdown.byStage} />
        <BreakdownTable title="By location" rows={breakdown.byLocation} />
      </div>
    </div>
  );
}
