import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { buildCompanyWhere, type CompanyListParams, PAGE_SIZE } from "@/app/(dashboard)/companies/queries";
import { dayBounds, daysAgo } from "@/lib/dates";
import { territoryWhereClause } from "@/lib/workspace/territory-match";
import type { Prisma } from "@/generated/prisma/client";

export type PipelineViewKey =
  | "board"
  | "my"
  | "team"
  | "unassigned"
  | "today"
  | "overdue"
  | "upcoming"
  | "recent"
  | "stale"
  | "won"
  | "lost"
  | "archived"
  | "saved";

export const PIPELINE_VIEWS: { key: PipelineViewKey; label: string }[] = [
  { key: "board", label: "Board" },
  { key: "my", label: "My Leads" },
  { key: "team", label: "Team Leads" },
  { key: "unassigned", label: "Unassigned Leads" },
  { key: "today", label: "Today's Follow-ups" },
  { key: "overdue", label: "Overdue Follow-ups" },
  { key: "upcoming", label: "Upcoming Follow-ups" },
  { key: "recent", label: "Recently Added" },
  { key: "stale", label: "No Recent Activity" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "archived", label: "Archived" },
  { key: "saved", label: "Saved Views" },
];

/** "Team Leads"/"Unassigned Leads" only make sense for a role broader than
 * "my own assigned leads" — a Salesperson's scope IS just their own leads,
 * so those two tabs would be redundant/misleading for them. */
export function isViewVisible(view: PipelineViewKey, canSeeBeyondOwn: boolean): boolean {
  if (view === "team" || view === "unassigned") return canSeeBeyondOwn;
  return true;
}

export function paramsForView(view: PipelineViewKey, userId: string): CompanyListParams {
  switch (view) {
    case "my":
      return { assignedToId: userId };
    case "unassigned":
      return { unassignedOnly: true };
    case "today":
      return { followUp: "today" };
    case "overdue":
      return { followUp: "overdue" };
    case "upcoming":
      return { followUp: "upcoming" };
    case "recent":
      return { sortBy: "createdAt", sortDir: "desc" };
    case "won":
      return { outcome: "WON" };
    case "lost":
      return { outcome: "LOST" };
    case "archived":
      return { status: "ARCHIVED" };
    case "team":
    case "board":
    case "stale":
    case "saved":
    default:
      return {};
  }
}

export type PipelineCardData = {
  id: string;
  name: string;
  city: string;
  region: string;
  leadTypeName: string;
  assignedToName: string | null;
  eosScore: number | null;
  competitorName: string | null;
  nextFollowUpAt: Date | null;
  overdue: boolean;
  daysSinceLastActivity: number | null;
  /** The instant used for staleness comparisons — latest activity, or the
   * company's createdAt when it has never had one. Not itself rendered. */
  activityReferenceAt: Date;
  contactName: string | null;
  contactMethod: { type: "phone" | "email"; value: string } | null;
  pipelineStageId: string;
};

const CARD_INCLUDE = {
  leadType: true,
  assignedTo: true,
  competitor: true,
  contacts: { orderBy: { lastName: "asc" as const }, take: 1 },
  activities: { orderBy: { occurredAt: "desc" as const }, take: 1 },
};

type CardCompany = Prisma.CompanyGetPayload<{ include: typeof CARD_INCLUDE }>;

function toCardData(company: CardCompany, now: Date): PipelineCardData {
  const contact = company.contacts[0];
  const lastActivity = company.activities[0];
  const { startOfToday } = dayBounds(now);

  const contactMethod = contact?.phone
    ? ({ type: "phone", value: contact.phone } as const)
    : contact?.email
      ? ({ type: "email", value: contact.email } as const)
      : null;

  return {
    id: company.id,
    name: company.name,
    city: company.city,
    region: company.region,
    leadTypeName: company.leadType.name,
    assignedToName: company.assignedTo?.name ?? null,
    eosScore: company.eosScore,
    competitorName: company.competitor?.name ?? null,
    nextFollowUpAt: company.nextFollowUpAt,
    overdue: company.nextFollowUpAt ? company.nextFollowUpAt < startOfToday : false,
    daysSinceLastActivity: lastActivity
      ? Math.floor((now.getTime() - lastActivity.occurredAt.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    activityReferenceAt: lastActivity?.occurredAt ?? company.createdAt,
    contactName: contact ? `${contact.firstName} ${contact.lastName}` : null,
    contactMethod,
    pipelineStageId: company.pipelineStageId,
  };
}

/** Resolves ?territoryId= into an extra Company WHERE clause. Returns
 * undefined for no territory filter, null if the territory id is invalid
 * (caller should treat as "no results" rather than "no filter"). */
async function resolveTerritoryClause(territoryId: string | undefined): Promise<Prisma.CompanyWhereInput | undefined | null> {
  if (!territoryId) return undefined;
  const territory = await prisma.territory.findUnique({ where: { id: territoryId } });
  if (!territory) return null;
  return territoryWhereClause(territory);
}

export type BoardColumn = {
  id: string;
  name: string;
  active: boolean;
  cards: PipelineCardData[];
};

export async function getBoardData(
  user: AuthenticatedUser,
  filters: CompanyListParams & { territoryId?: string },
): Promise<{ columns: BoardColumn[] } | null> {
  const territoryClause = await resolveTerritoryClause(filters.territoryId);
  if (territoryClause === null) return { columns: [] };

  const baseWhere = buildCompanyWhere(user, { ...filters, status: "ACTIVE" });
  if (!baseWhere) return null;

  const where = territoryClause ? { AND: [baseWhere, territoryClause] } : baseWhere;

  const [allStages, companies] = await Promise.all([
    prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.company.findMany({ where, include: CARD_INCLUDE, orderBy: { name: "asc" } }),
  ]);

  const now = new Date();
  const cardsByStage = new Map<string, PipelineCardData[]>();
  for (const company of companies) {
    const card = toCardData(company, now);
    const list = cardsByStage.get(card.pipelineStageId) ?? [];
    list.push(card);
    cardsByStage.set(card.pipelineStageId, list);
  }

  // Active stages always get a column, even empty. An inactive stage only
  // gets one if an existing company still sits in it — inactive just
  // blocks new assignment into it, not rendering of what's already there.
  const columns: BoardColumn[] = allStages
    .filter((stage) => stage.active || (cardsByStage.get(stage.id)?.length ?? 0) > 0)
    .map((stage) => ({
      id: stage.id,
      name: stage.name,
      active: stage.active,
      cards: cardsByStage.get(stage.id) ?? [],
    }));

  return { columns };
}

export async function getPipelineListView(
  user: AuthenticatedUser,
  params: CompanyListParams & { territoryId?: string; page?: number },
): Promise<{ cards: PipelineCardData[]; total: number; page: number; pageCount: number } | null> {
  const territoryClause = await resolveTerritoryClause(params.territoryId);
  if (territoryClause === null) return { cards: [], total: 0, page: 1, pageCount: 1 };

  const baseWhere = buildCompanyWhere(user, params);
  if (!baseWhere) return null;

  const where = territoryClause ? { AND: [baseWhere, territoryClause] } : baseWhere;
  const page = Math.max(1, params.page ?? 1);
  const sortBy = params.sortBy ?? "name";
  const sortDir = params.sortDir === "desc" ? "desc" : "asc";

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: CARD_INCLUDE,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.company.count({ where }),
  ]);

  const now = new Date();
  return {
    cards: companies.map((c) => toCardData(c, now)),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** "No Recent Activity" can't be expressed as a simple WHERE filter (it
 * depends on each company's latest related Activity), so this fetches the
 * scoped active set with its latest activity included and filters/sorts in
 * memory — reasonable at this app's scale, and consistent with how
 * dashboard/priority logic already treats "days since activity". */
export async function getStaleCompanies(
  user: AuthenticatedUser,
  filters: CompanyListParams & { territoryId?: string },
  thresholdDays: number,
): Promise<{ cards: PipelineCardData[] } | null> {
  const territoryClause = await resolveTerritoryClause(filters.territoryId);
  if (territoryClause === null) return { cards: [] };

  const baseWhere = buildCompanyWhere(user, { ...filters, status: "ACTIVE" });
  if (!baseWhere) return null;

  const where = territoryClause ? { AND: [baseWhere, territoryClause] } : baseWhere;
  const companies = await prisma.company.findMany({ where, include: CARD_INCLUDE, orderBy: { name: "asc" } });

  const now = new Date();
  const threshold = daysAgo(thresholdDays, now);

  const cards = companies
    .map((c) => toCardData(c, now))
    .filter((card) => card.activityReferenceAt < threshold)
    .sort((a, b) => a.activityReferenceAt.getTime() - b.activityReferenceAt.getTime());

  return { cards };
}

export async function listSavedViews(user: AuthenticatedUser) {
  const views = await prisma.savedView.findMany({
    where: { archivedAt: null, OR: [{ ownerId: user.id }, { visibility: "SHARED" }] },
    include: { owner: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return views.map((v) => ({
    id: v.id,
    name: v.name,
    visibility: v.visibility,
    isDefault: v.isDefault,
    isMine: v.ownerId === user.id,
    ownerName: v.owner.name,
    filters: v.filters,
  }));
}
