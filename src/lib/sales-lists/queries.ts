import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { companyScope } from "@/lib/companies/scope";
import { buildCompanyWhere, PAGE_SIZE, SORTABLE_FIELDS_LIST } from "@/app/(dashboard)/companies/queries";
import { salesListVisibilityWhere } from "./scope";
import { parseSalesListFilters, toCompanyListParams } from "./filters";
import { evaluateCompanyEligibility } from "./eligibility";
import type { Prisma } from "@/generated/prisma/client";
import type { SalesListPurpose } from "@/generated/prisma/enums";

const SORTABLE_FIELDS = new Set<string>(SORTABLE_FIELDS_LIST);

const CONTACT_ACTIVITY_TYPES = ["PHONE", "EMAIL", "MEETING", "MATERIAL_SENT", "DEMO", "TRIAL"] as const;

/** Most recent contact-type Activity date per company, for the List
 * detail page's "Last Contact" column — one DISTINCT ON query rather than
 * N per-company lookups. */
export async function getLastContactDates(companyIds: string[]): Promise<Record<string, Date | null>> {
  if (companyIds.length === 0) return {};
  const rows = await prisma.activity.findMany({
    where: { companyId: { in: companyIds }, type: { in: [...CONTACT_ACTIVITY_TYPES] } },
    select: { companyId: true, occurredAt: true },
    orderBy: [{ companyId: "asc" }, { occurredAt: "desc" }],
    distinct: ["companyId"],
  });
  const result: Record<string, Date | null> = {};
  for (const id of companyIds) result[id] = null;
  for (const row of rows) result[row.companyId] = row.occurredAt;
  return result;
}

/** Fields every List page/preview/eligibility check needs — one shared
 * include so the shape stays consistent across FIXED and DYNAMIC paths. */
export const SALES_LIST_COMPANY_INCLUDE = {
  leadType: true,
  pipelineStage: true,
  assignedTo: true,
  competitor: true,
  primaryContact: true,
} satisfies Prisma.CompanyInclude;

export type SalesListCompanyRow = Prisma.CompanyGetPayload<{ include: typeof SALES_LIST_COMPANY_INCLUDE }>;

export async function listSalesLists(
  user: AuthenticatedUser,
  params: { purpose?: SalesListPurpose; active?: boolean; q?: string },
) {
  const scope = salesListVisibilityWhere(user);
  if (!scope) return [];

  const filters: Prisma.SalesListWhereInput[] = [scope, { archivedAt: params.active === false ? { not: null } : null }];
  if (params.purpose) filters.push({ purpose: params.purpose });
  if (params.q) filters.push({ name: { contains: params.q, mode: "insensitive" } });

  return prisma.salesList.findMany({
    where: { AND: filters },
    include: { owner: true, _count: { select: { members: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getSalesListById(user: AuthenticatedUser, id: string) {
  const scope = salesListVisibilityWhere(user);
  if (!scope) return null;

  return prisma.salesList.findFirst({
    where: { id, ...scope },
    include: { owner: true, shares: { include: { user: true } } },
  });
}

/** Runs a DYNAMIC list's filters live against current CRM data — the same
 * shared buildCompanyWhere() every company list view uses, so a list's
 * "matching companies" can never silently drift from what Companies/
 * Pipeline would show for the identical filter set. Used only by
 * refreshDynamicList()'s diff-against-cache step, which needs every
 * matching id (not a page of them, and not the display-only relations
 * SALES_LIST_COMPANY_INCLUDE carries) — the List Builder's live preview is
 * a different, paginated function (previewListCompanies). */
export async function evaluateDynamicFilters(user: AuthenticatedUser, filters: unknown): Promise<{ id: string }[]> {
  const parsed = parseSalesListFilters(filters);
  const where = buildCompanyWhere(user, toCompanyListParams(parsed));
  if (!where) return [];
  return prisma.company.findMany({ where, select: { id: true } });
}

type ListLike = { id: string; type: "FIXED" | "DYNAMIC"; filters: unknown };

/** Paginated, searched, sorted company listing for a list's detail page —
 * works for both FIXED (membership = explicit SalesListMember rows) and
 * DYNAMIC (membership = the cached SalesListDynamicMember snapshot from the
 * last refresh, never a live re-query on every page view) lists. Every
 * company returned is still re-checked against the viewer's own
 * companyScope() — being on a shared list never grants access to a company
 * outside the viewer's normal permissions. */
export async function getListCompanies(
  user: AuthenticatedUser,
  list: ListLike,
  params: { q?: string; sortBy?: string; sortDir?: string; page?: number },
): Promise<{ companies: SalesListCompanyRow[]; total: number; page: number; pageCount: number } | null> {
  const scope = companyScope(user);
  if (!scope) return null;

  const sortBy = params.sortBy && SORTABLE_FIELDS.has(params.sortBy) ? params.sortBy : "name";
  const sortDir = params.sortDir === "desc" ? "desc" : "asc";
  const page = Math.max(1, params.page ?? 1);

  const membershipWhere: Prisma.CompanyWhereInput =
    list.type === "FIXED" ? { salesListMembers: { some: { listId: list.id } } } : { salesListDynamicMembers: { some: { listId: list.id } } };

  const filters: Prisma.CompanyWhereInput[] = [scope, membershipWhere];
  if (params.q) {
    filters.push({
      OR: [
        { name: { contains: params.q, mode: "insensitive" } },
        { city: { contains: params.q, mode: "insensitive" } },
        { email: { contains: params.q, mode: "insensitive" } },
        { phone: { contains: params.q, mode: "insensitive" } },
      ],
    });
  }
  const where: Prisma.CompanyWhereInput = { AND: filters };

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: SALES_LIST_COMPANY_INCLUDE,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.company.count({ where }),
  ]);

  return { companies, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Cheap counts for the List page header — total membership (fixed rows or
 * last-cached dynamic rows) without paginating/fetching full records. */
export async function getListMembershipCount(list: ListLike): Promise<number> {
  if (list.type === "FIXED") return prisma.salesListMember.count({ where: { listId: list.id } });
  return prisma.salesListDynamicMember.count({ where: { listId: list.id } });
}

/** List Builder's live preview — every company currently matching the
 * in-progress filter selection, paginated, before anything is saved.
 * Purpose doesn't narrow the query itself (that's what the filters are
 * for) — it only changes which eligibility reasons get computed for
 * display, per the spec's "keep ineligible companies visible and explain
 * why" requirement. */
export async function previewListCompanies(
  user: AuthenticatedUser,
  filters: unknown,
  params: { page?: number; sortBy?: string; sortDir?: string },
): Promise<{ companies: SalesListCompanyRow[]; total: number; page: number; pageCount: number } | null> {
  const parsed = parseSalesListFilters(filters);
  const listParams = { ...toCompanyListParams(parsed), sortBy: params.sortBy ?? parsed.sortBy, sortDir: params.sortDir ?? parsed.sortDir };
  const where = buildCompanyWhere(user, listParams);
  if (!where) return null;

  const sortBy = listParams.sortBy && SORTABLE_FIELDS.has(listParams.sortBy) ? listParams.sortBy : "name";
  const sortDir = listParams.sortDir === "desc" ? "desc" : "asc";
  const page = Math.max(1, params.page ?? 1);

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: SALES_LIST_COMPANY_INCLUDE,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.company.count({ where }),
  ]);

  return { companies, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

const ELIGIBILITY_SELECT = {
  id: true,
  status: true,
  doNotContact: true,
  isExistingCustomer: true,
  phone: true,
  primaryContact: { select: { status: true, email: true, phone: true, doNotContact: true, unsubscribedAt: true } },
} satisfies Prisma.CompanySelect;

/** Eligible/ineligible counts across a list's ENTIRE membership (not just
 * the current page) — the List page header's "Eligible count"/"Ineligible
 * count". Fetches only the small field set evaluateCompanyEligibility
 * actually needs, not the full company record. */
export async function getListEligibilitySummary(
  user: AuthenticatedUser,
  list: ListLike,
  purpose: SalesListPurpose,
): Promise<{ eligible: number; ineligible: number }> {
  const scope = companyScope(user);
  if (!scope) return { eligible: 0, ineligible: 0 };

  const membershipWhere: Prisma.CompanyWhereInput =
    list.type === "FIXED" ? { salesListMembers: { some: { listId: list.id } } } : { salesListDynamicMembers: { some: { listId: list.id } } };

  const companies = await prisma.company.findMany({ where: { AND: [scope, membershipWhere] }, select: ELIGIBILITY_SELECT });

  let eligible = 0;
  for (const company of companies) {
    if (evaluateCompanyEligibility(company, purpose).eligible) eligible++;
  }
  return { eligible, ineligible: companies.length - eligible };
}

// Safety cap on "select all matching" — mirrors the audit-log CSV export's
// existing 5,000-row cap precedent (src/app/(dashboard)/administration/
// audit-log). A filter this broad almost certainly wants narrowing before
// being turned into a fixed list anyway.
const SELECT_ALL_MATCHING_CAP = 5000;

/** Every company id currently matching the in-progress filter selection,
 * up to a safety cap — backs the List Builder's "select all matching"
 * button (as opposed to "select this page," which is plain client state). */
export async function selectAllMatchingCompanyIds(user: AuthenticatedUser, filters: unknown): Promise<{ ids: string[]; truncated: boolean }> {
  const parsed = parseSalesListFilters(filters);
  const where = buildCompanyWhere(user, toCompanyListParams(parsed));
  if (!where) return { ids: [], truncated: false };

  const rows = await prisma.company.findMany({ where, select: { id: true }, take: SELECT_ALL_MATCHING_CAP + 1, orderBy: { name: "asc" } });
  const truncated = rows.length > SELECT_ALL_MATCHING_CAP;
  return { ids: rows.slice(0, SELECT_ALL_MATCHING_CAP).map((r) => r.id), truncated };
}
