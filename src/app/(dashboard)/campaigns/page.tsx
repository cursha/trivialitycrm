import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { listCampaigns } from "@/lib/campaigns/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CAMPAIGN_STATUS_TONE, humanizeEnum } from "@/lib/ui/status-tones";

export const metadata = { title: "Campaigns — Triviality CRM" };

export default async function CampaignsIndexPage() {
  const user = await requireUser();
  const campaigns = await listCampaigns(user);
  const canCreate = hasPermission(user, "create_campaigns");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Campaigns"
        description="AI-personalized email campaigns built from an Email Campaign sales list. Start a new one from that list's page."
      />

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState>
            No campaigns yet.{" "}
            {canCreate && (
              <>
                Start one from an{" "}
                <Link href="/sales-lists" className="text-secondary hover:underline">
                  Email Campaign list
                </Link>
                .
              </>
            )}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-black/5 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">List</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Recipients</th>
                  <th className="px-5 py-3">Created by</th>
                  <th className="px-5 py-3">Updated</th>
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
                    <td className="px-5 py-4">{campaign._count.recipients}</td>
                    <td className="px-5 py-4">{campaign.createdBy.name}</td>
                    <td className="px-5 py-4">{new Date(campaign.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-border md:hidden">
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
                    <dt className="text-text-muted">Recipients</dt>
                    <dd className="font-medium text-text">{campaign._count.recipients}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Created by</dt>
                    <dd className="font-medium text-text">{campaign.createdBy.name}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-text-muted">Updated {new Date(campaign.updatedAt).toLocaleDateString()}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
