import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { getBoardData, getPipelineListView, getStaleCompanies, listSavedViews, paramsForView, type PipelineViewKey } from "./queries";
import { Board } from "./board";
import { ListView } from "./list-view";
import { ViewTabs } from "./view-tabs";
import { FilterBar } from "./filter-bar";
import { SavedViewsPanel } from "./saved-views-panel";

export const metadata = { title: "Pipeline — Triviality CRM" };

const VALID_VIEWS = new Set<PipelineViewKey>([
  "board",
  "my",
  "team",
  "unassigned",
  "today",
  "overdue",
  "upcoming",
  "recent",
  "stale",
  "won",
  "lost",
  "archived",
  "saved",
]);

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const canSeeBeyondOwn = hasPermission(user, "view_team_leads") || hasPermission(user, "view_all_leads");
  const canViewAny = canSeeBeyondOwn || hasPermission(user, "view_assigned_leads");

  if (!canViewAny) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Pipeline" />
        <p className="mt-2 text-text-muted">
          Your account doesn&apos;t have a lead-viewing permission yet — ask an Administrator to grant one.
        </p>
      </div>
    );
  }

  const requestedView = toSingle(params.view);
  const view: PipelineViewKey = requestedView && VALID_VIEWS.has(requestedView as PipelineViewKey) ? (requestedView as PipelineViewKey) : "board";

  const canEdit = hasPermission(user, "edit_leads");
  const canBulk = hasPermission(user, "bulk_update_leads");

  const filters = {
    leadTypeId: toSingle(params.leadTypeId),
    assignedToId: toSingle(params.assignedToId),
    competitorId: toSingle(params.competitorId),
    territoryId: toSingle(params.territoryId),
  };

  const [leadTypes, salespeople, competitors, territories, workspaceSettings] = await Promise.all([
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.territory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.workspaceSettings.findUnique({ where: { id: 1 } }),
  ]);

  const territoryOptions = territories.map((t) => ({
    id: t.id,
    name: t.name ?? [t.city, t.region, t.country].filter(Boolean).join(", "),
  }));

  const queryStringForTabs = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => !!entry[1]),
  ).toString();

  const page = Number(toSingle(params.page)) || 1;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Pipeline"
        description="Your daily sales workspace — the board, curated work views, and saved filters."
      />

      <FilterBar leadTypes={leadTypes} salespeople={salespeople} competitors={competitors} territories={territoryOptions} />

      <ViewTabs active={view} canSeeBeyondOwn={canSeeBeyondOwn} queryString={queryStringForTabs} />

      {view === "board" ? (
        <BoardSection user={user} filters={filters} canEdit={canEdit} />
      ) : view === "saved" ? (
        <SavedViewsSection user={user} />
      ) : view === "stale" ? (
        <StaleSection
          user={user}
          filters={filters}
          canEdit={canEdit}
          canBulk={canBulk}
          salespeople={salespeople}
          territoryOptions={territoryOptions}
          thresholdDays={workspaceSettings?.noActivityThresholdDays ?? 14}
        />
      ) : (
        <ListSection
          user={user}
          view={view}
          filters={filters}
          page={page}
          canEdit={canEdit}
          canBulk={canBulk}
          salespeople={salespeople}
          territoryOptions={territoryOptions}
        />
      )}
    </div>
  );
}

async function BoardSection({
  user,
  filters,
  canEdit,
}: {
  user: Awaited<ReturnType<typeof requireUser>>;
  filters: { leadTypeId?: string; assignedToId?: string; competitorId?: string; territoryId?: string };
  canEdit: boolean;
}) {
  const data = await getBoardData(user, filters);
  if (!data) return <p className="text-text-muted">You do not have access to view the pipeline.</p>;
  return <Board columns={data.columns} canEdit={canEdit} />;
}

async function ListSection({
  user,
  view,
  filters,
  page,
  canEdit,
  canBulk,
  salespeople,
  territoryOptions,
}: {
  user: Awaited<ReturnType<typeof requireUser>>;
  view: PipelineViewKey;
  filters: { leadTypeId?: string; assignedToId?: string; competitorId?: string; territoryId?: string };
  page: number;
  canEdit: boolean;
  canBulk: boolean;
  salespeople: { id: string; name: string }[];
  territoryOptions: { id: string; name: string }[];
}) {
  const viewParams = paramsForView(view, user.id);
  const data = await getPipelineListView(user, { ...viewParams, ...filters, page });
  if (!data) return <p className="text-text-muted">You do not have access to view the pipeline.</p>;

  const stageOptions = await prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <ListView
      cards={data.cards}
      stages={stageOptions.map((s) => ({ id: s.id, name: s.name, active: s.active }))}
      canEdit={canEdit}
      canBulk={canBulk}
      salespeople={salespeople}
      territories={territoryOptions}
      page={data.page}
      pageCount={data.pageCount}
    />
  );
}

async function StaleSection({
  user,
  filters,
  canEdit,
  canBulk,
  salespeople,
  territoryOptions,
  thresholdDays,
}: {
  user: Awaited<ReturnType<typeof requireUser>>;
  filters: { leadTypeId?: string; assignedToId?: string; competitorId?: string; territoryId?: string };
  canEdit: boolean;
  canBulk: boolean;
  salespeople: { id: string; name: string }[];
  territoryOptions: { id: string; name: string }[];
  thresholdDays: number;
}) {
  const data = await getStaleCompanies(user, filters, thresholdDays);
  if (!data) return <p className="text-text-muted">You do not have access to view the pipeline.</p>;

  const stageOptions = await prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <ListView
      cards={data.cards}
      stages={stageOptions.map((s) => ({ id: s.id, name: s.name, active: s.active }))}
      canEdit={canEdit}
      canBulk={canBulk}
      salespeople={salespeople}
      territories={territoryOptions}
    />
  );
}

async function SavedViewsSection({ user }: { user: Awaited<ReturnType<typeof requireUser>> }) {
  const views = await listSavedViews(user);
  return (
    <SavedViewsPanel
      views={views.map((v) => ({
        id: v.id,
        name: v.name,
        visibility: v.visibility,
        isDefault: v.isDefault,
        isMine: v.isMine,
        ownerName: v.ownerName,
        filters: (v.filters as Record<string, unknown>) ?? {},
      }))}
      canCreateShared={hasPermission(user, "create_shared_views")}
    />
  );
}
