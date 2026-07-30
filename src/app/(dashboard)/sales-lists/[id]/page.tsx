import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { getSalesListById, getListCompanies, getListMembershipCount, getListEligibilitySummary, getLastContactDates } from "@/lib/sales-lists/queries";
import { canManageSalesList } from "@/lib/sales-lists/scope";
import { hasPermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getActiveSessionForUser } from "@/lib/calling/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { PAGE_SIZE } from "@/app/(dashboard)/companies/queries";
import { ListDetailTable } from "./list-detail-table";
import { ListActionsBar } from "./list-actions-bar";
import { StartCallingSessionButton } from "./start-calling-session-button";
import { CAMPAIGN_STATUS_TONE, humanizeEnum } from "@/lib/ui/status-tones";

const PURPOSE_LABEL: Record<string, string> = {
  CALLING: "Calling List",
  EMAIL_CAMPAIGN: "Email Campaign",
  GENERAL_SALES: "General Sales List",
};

const VISIBILITY_LABEL: Record<string, string> = {
  PRIVATE: "Private",
  SHARED_USERS: "Shared with selected users",
  SHARED_TEAM: "Shared with your team",
};

const FILTER_LABELS: Record<string, string> = {
  q: "Search",
  country: "Country",
  region: "State/Province",
  city: "City",
  cities: "Cities",
  leadTypeId: "Lead type",
  pipelineStageId: "Pipeline stage",
  assignedToId: "Owner",
  competitorId: "Competitor",
  triviaStatus: "Trivia status",
  confidenceLevel: "Confidence",
  primaryClassification: "Classification",
  scoreMin: "EOS score ≥",
  scoreMax: "EOS score ≤",
  followUp: "Follow-up",
  neverContactedOnly: "Never contacted",
  lastContactedBefore: "Last contacted before",
  hasPhone: "Has phone",
  hasEmail: "Has email",
  isExistingCustomer: "Existing customer",
  doNotContactOnly: "Do-not-contact only",
  neverAnalyzedOnly: "Never analyzed",
  lastAnalyzedBefore: "Last analyzed before",
  hasDataQualityWarnings: "Has data-quality warnings",
  status: "Status",
};

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SalesListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;

  const list = await getSalesListById(user, id);
  if (!list) notFound();

  const page = Number(toSingle(query.page)) || 1;
  const [companiesResult, total, eligibility] = await Promise.all([
    getListCompanies(user, list, { q: toSingle(query.q), sortBy: toSingle(query.sortBy), sortDir: toSingle(query.sortDir), page }),
    getListMembershipCount(list),
    getListEligibilitySummary(user, list, list.purpose),
  ]);

  const companies = companiesResult?.companies ?? [];
  const pageCount = companiesResult?.pageCount ?? 1;
  const lastContactByCompanyId = await getLastContactDates(companies.map((c) => c.id));

  const canManage = canManageSalesList(user, list);
  const canDelete = hasPermission(user, "manage_all_sales_lists");
  const canExport = hasPermission(user, "export_leads");
  const canCall = list.purpose === "CALLING" && hasPermission(user, "use_calling_lists");
  const canCampaign = list.purpose === "EMAIL_CAMPAIGN" && hasPermission(user, "create_campaigns");
  const filterEntries = list.type === "DYNAMIC" && list.filters ? Object.entries(list.filters as Record<string, unknown>) : [];
  const [activeSession, workspaceSettings, campaigns] = await Promise.all([
    canCall ? getActiveSessionForUser(user.id) : Promise.resolve(null),
    canCall ? prisma.workspaceSettings.findUnique({ where: { id: 1 } }) : Promise.resolve(null),
    canCampaign ? prisma.campaign.findMany({ where: { listId: list.id }, orderBy: { updatedAt: "desc" } }) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={list.name}
        description={list.description ?? undefined}
        actions={
          canExport ? (
            <a
              href={`/api/export/companies?format=csv&listId=${list.id}`}
              className="rounded-lg border border-border-strong px-4 py-2.5 text-sm font-semibold text-text hover:bg-black/5"
            >
              Export CSV
            </a>
          ) : undefined
        }
      />

      <Card className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge tone="secondary">{PURPOSE_LABEL[list.purpose]}</Badge>
          <Badge tone="neutral">{list.type === "FIXED" ? "Fixed" : "Dynamic"}</Badge>
          <Badge tone="neutral">{VISIBILITY_LABEL[list.visibility]}</Badge>
          {list.archivedAt && <Badge tone="warning">Archived</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <div>
            <dt className="text-text-muted">Creator</dt>
            <dd className="font-medium text-text">{list.owner.name}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Current count</dt>
            <dd className="font-medium text-text">{total.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Eligible</dt>
            <dd className="font-medium text-text">{eligibility.eligible.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Ineligible</dt>
            <dd className="font-medium text-text">{eligibility.ineligible.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Created</dt>
            <dd className="font-medium text-text">{new Date(list.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Updated</dt>
            <dd className="font-medium text-text">{new Date(list.updatedAt).toLocaleString()}</dd>
          </div>
          {list.type === "DYNAMIC" && (
            <div>
              <dt className="text-text-muted">Last refreshed</dt>
              <dd className="font-medium text-text">{list.lastEvaluatedAt ? new Date(list.lastEvaluatedAt).toLocaleString() : "Never — click Refresh"}</dd>
            </div>
          )}
        </dl>
        {filterEntries.length > 0 && (
          <div>
            <p className="text-xs font-bold uppercase text-text-muted">Saved filters</p>
            <p className="text-sm text-text">
              {filterEntries.map(([key, value]) => `${FILTER_LABELS[key] ?? key}: ${String(value)}`).join(" · ")}
            </p>
          </div>
        )}
      </Card>

      {canCall && !list.archivedAt && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          {activeSession ? (
            <>
              <span className="text-sm font-semibold">
                You have a calling session {activeSession.status === "PAUSED" ? "paused" : "in progress"}
                {activeSession.listId === list.id ? " for this list" : ` for "${activeSession.list.name}"`}.
              </span>
              <Link href={`/calling-sessions/${activeSession.id}`} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover">
                Continue
              </Link>
            </>
          ) : (
            <StartCallingSessionButton listId={list.id} defaultOrderBy={workspaceSettings?.defaultCallingOrderBy ?? "salesPriorityScore"} />
          )}
        </Card>
      )}

      {canCampaign && !list.archivedAt && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-semibold">Email campaigns built from this list</span>
            <Link href={`/campaigns/new?listId=${list.id}`} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover">
              Start a campaign
            </Link>
          </div>
          {campaigns.length > 0 && (
            <ul className="divide-y divide-border text-sm">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/campaigns/${campaign.id}`} className="font-medium text-secondary hover:underline">
                    {campaign.name}
                  </Link>
                  <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status] ?? "neutral"}>{humanizeEnum(campaign.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ListActionsBar listId={list.id} type={list.type} archived={!!list.archivedAt} canManage={canManage} canDelete={canDelete} />

      <ListDetailTable
        listId={list.id}
        purpose={list.purpose}
        type={list.type}
        companies={companies}
        lastContactByCompanyId={Object.fromEntries(Object.entries(lastContactByCompanyId).map(([k, v]) => [k, v]))}
        canManage={canManage}
      />

      <Pagination page={page} pageCount={pageCount} pageSize={PAGE_SIZE} hrefFor={(p) => `/sales-lists/${list.id}?page=${p}`} />
    </div>
  );
}
