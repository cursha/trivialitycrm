import "server-only";
import type { AppTransactionClient } from "@/lib/prisma";
import { prisma } from "@/lib/prisma";
import { companyScope } from "@/lib/companies/scope";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { writeAuditEvent } from "@/lib/audit/log";
import { buildCsv } from "@/lib/export/serialize";
import { zonedCalendarDate } from "@/lib/timezone";
import { Prisma } from "@/generated/prisma/client";
import { resolveRouteAddOutcome, sortRouteCompanies, normalizeCountry, formatRouteAddress, missingRouteAddressFields, buildRoutePlanFilename, type RouteAddOutcome } from "./validation";

export type RouteSummary = {
  /** The current route; null until the user's first route exists. */
  id: string | null;
  name: string | null;
  /** YYYY-MM-DD, when the route has a planned day. */
  plannedDate: string | null;
  count: number;
  leadTypeId: string | null;
  leadTypeName: string | null;
  country: string | null;
};

const EMPTY_SUMMARY: RouteSummary = { id: null, name: null, plannedDate: null, count: 0, leadTypeId: null, leadTypeName: null, country: null };
export const DEFAULT_ROUTE_NAME = "My route";

type Db = AppTransactionClient | typeof prisma;

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * A user can keep several named routes; User.activeRoutePlanId is the
 * current one, which every add/remove/clear/review/export below works on.
 * Only ever resolves to a route the user owns.
 */
async function activeRouteId(db: Db, userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { activeRoutePlanId: true } });
  if (!user?.activeRoutePlanId) return null;
  const owned = await db.routePlan.findFirst({ where: { id: user.activeRoutePlanId, userId }, select: { id: true } });
  return owned?.id ?? null;
}

/** The current route, creating "My route" (and making it current) when the
 * user has none yet — the first "Add to route" just works. */
async function ensureActiveRoute(tx: AppTransactionClient, userId: string) {
  const id = await activeRouteId(tx, userId);
  if (id) return tx.routePlan.findUniqueOrThrow({ where: { id } });
  const route = await tx.routePlan.create({ data: { userId, name: DEFAULT_ROUTE_NAME } });
  await tx.user.update({ where: { id: userId }, data: { activeRoutePlanId: route.id } });
  return route;
}

/** A route the user picked by id (must be theirs), or their current route
 * (created if they have none) when no id is given. */
async function resolveTargetRoute(tx: AppTransactionClient, userId: string, routeId?: string | null) {
  if (!routeId) return ensureActiveRoute(tx, userId);
  return tx.routePlan.findFirst({ where: { id: routeId, userId } });
}

/** Company ids on ANY of the user's routes — My Day's "not on a route yet". */
export async function getAllRoutedCompanyIds(userId: string): Promise<Set<string>> {
  const entries = await prisma.routePlanCompany.findMany({ where: { routePlan: { userId } }, select: { companyId: true } });
  return new Set(entries.map((entry) => entry.companyId));
}

export type CompanyRouteOption = { id: string; name: string; plannedDate: string | null; isActive: boolean; inRoute: boolean };

/** The user's routes with whether each already includes this company — for
 * the "Add to route" picker on a company. */
export async function getCompanyRouteOptions(userId: string, companyId: string): Promise<CompanyRouteOption[]> {
  const [routes, memberships] = await Promise.all([
    listRoutes(userId),
    prisma.routePlanCompany.findMany({ where: { companyId, routePlan: { userId } }, select: { routePlanId: true } }),
  ]);
  const inRoute = new Set(memberships.map((m) => m.routePlanId));
  return routes.map((route) => ({ id: route.id, name: route.name, plannedDate: route.plannedDate, isActive: route.isActive, inRoute: inRoute.has(route.id) }));
}

/** The header badge count and page title need this on effectively every
 * page load — cheap (a couple of small reads), so no caching beyond Next's
 * own per-request dedup. Creates nothing: an empty summary for a user who
 * has never opened Route Plan is just zeros, not a DB write. */
export async function getRouteSummary(userId: string): Promise<RouteSummary> {
  const id = await activeRouteId(prisma, userId);
  if (!id) return EMPTY_SUMMARY;
  const route = await prisma.routePlan.findUnique({
    where: { id },
    include: { leadType: true, _count: { select: { companies: true } } },
  });
  if (!route) return EMPTY_SUMMARY;
  return {
    id: route.id,
    name: route.name,
    plannedDate: isoDate(route.plannedDate),
    count: route._count.companies,
    leadTypeId: route.leadTypeId,
    leadTypeName: route.leadType?.name ?? null,
    country: route.country,
  };
}

/** Set of company IDs currently in the user's current route — used to
 * render "already in route" state on the company profile and list,
 * distinct from (and never confused with) a bulk-action page-selection
 * checkbox. */
export async function getRouteCompanyIds(userId: string): Promise<Set<string>> {
  const id = await activeRouteId(prisma, userId);
  if (!id) return new Set();
  const entries = await prisma.routePlanCompany.findMany({ where: { routePlanId: id }, select: { companyId: true } });
  return new Set(entries.map((c) => c.companyId));
}

export type RouteListItem = { id: string; name: string; plannedDate: string | null; count: number; isActive: boolean };

/** All of the user's routes for the Route Plan page's picker: dated routes
 * first (soonest first), then undated ones by name. */
export async function listRoutes(userId: string): Promise<RouteListItem[]> {
  const [routes, activeId] = await Promise.all([
    prisma.routePlan.findMany({
      where: { userId },
      include: { _count: { select: { companies: true } } },
      orderBy: [{ plannedDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    }),
    activeRouteId(prisma, userId),
  ]);
  return routes.map((route) => ({
    id: route.id,
    name: route.name,
    plannedDate: isoDate(route.plannedDate),
    count: route._count.companies,
    isActive: route.id === activeId,
  }));
}

export type RouteMutationResult = { ok: true } | { ok: false; error: string };

function parseRouteFields(name: string, plannedDate: string | null): { ok: true; name: string; plannedDate: Date | null } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the route a name, e.g. Mississauga." };
  if (trimmed.length > 80) return { ok: false, error: "Keep the route name under 80 characters." };
  if (!plannedDate) return { ok: true, name: trimmed, plannedDate: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) return { ok: false, error: "Enter a valid date." };
  const date = new Date(`${plannedDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || isoDate(date) !== plannedDate) return { ok: false, error: "Enter a valid date." };
  return { ok: true, name: trimmed, plannedDate: date };
}

/** Creates a new, empty route and makes it the current one. */
export async function createRoute(user: AuthenticatedUser, name: string, plannedDate: string | null): Promise<RouteMutationResult> {
  requirePermission(user, "manage_route_plan");
  const fields = parseRouteFields(name, plannedDate);
  if (!fields.ok) return fields;

  const route = await prisma.$transaction(async (tx) => {
    const created = await tx.routePlan.create({ data: { userId: user.id, name: fields.name, plannedDate: fields.plannedDate } });
    await tx.user.update({ where: { id: user.id }, data: { activeRoutePlanId: created.id } });
    return created;
  });
  await writeAuditEvent({ actorId: user.id, module: "route-plan", action: "route_plan.created", entityType: "RoutePlan", entityId: route.id, metadata: { name: route.name } });
  return { ok: true };
}

/** Renames a route and/or changes its planned day. */
export async function updateRoute(user: AuthenticatedUser, routeId: string, name: string, plannedDate: string | null): Promise<RouteMutationResult> {
  requirePermission(user, "manage_route_plan");
  const fields = parseRouteFields(name, plannedDate);
  if (!fields.ok) return fields;

  const { count } = await prisma.routePlan.updateMany({ where: { id: routeId, userId: user.id }, data: { name: fields.name, plannedDate: fields.plannedDate } });
  if (count === 0) return { ok: false, error: "That route no longer exists." };
  return { ok: true };
}

/** Makes one of the user's routes the current one. */
export async function selectRoute(user: AuthenticatedUser, routeId: string): Promise<RouteMutationResult> {
  requirePermission(user, "view_route_plan");
  const owned = await prisma.routePlan.findFirst({ where: { id: routeId, userId: user.id }, select: { id: true } });
  if (!owned) return { ok: false, error: "That route no longer exists." };
  await prisma.user.update({ where: { id: user.id }, data: { activeRoutePlanId: owned.id } });
  return { ok: true };
}

/** Deletes one of the user's routes (its stops go with it; the companies
 * themselves are untouched). If it was current, the next route in the list
 * becomes current. */
export async function deleteRoute(user: AuthenticatedUser, routeId: string): Promise<RouteMutationResult> {
  requirePermission(user, "manage_route_plan");
  const route = await prisma.routePlan.findFirst({ where: { id: routeId, userId: user.id }, include: { _count: { select: { companies: true } } } });
  if (!route) return { ok: false, error: "That route no longer exists." };

  await prisma.$transaction(async (tx) => {
    const wasActive = (await activeRouteId(tx, user.id)) === route.id;
    await tx.routePlan.delete({ where: { id: route.id } });
    if (wasActive) {
      const next = await tx.routePlan.findFirst({
        where: { userId: user.id },
        orderBy: [{ plannedDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
        select: { id: true },
      });
      await tx.user.update({ where: { id: user.id }, data: { activeRoutePlanId: next?.id ?? null } });
    }
  });
  await writeAuditEvent({
    actorId: user.id,
    module: "route-plan",
    action: "route_plan.deleted",
    entityType: "RoutePlan",
    entityId: route.id,
    metadata: { name: route.name, companyCount: route._count.companies },
  });
  return { ok: true };
}

export type RouteConflictDetail =
  | { type: "ineligible"; leadTypeName: string }
  | { type: "lead_type_conflict"; currentLeadTypeName: string; newLeadTypeName: string }
  | { type: "country_conflict"; currentCountry: string; newCountry: string };

export type AddToRouteResult =
  | { ok: true; count: number; alreadyInRoute: boolean; routeName: string }
  | { ok: false; error: string }
  | { ok: false; conflict: RouteConflictDetail };

/** Which route to add to: one of the user's routes by id, a brand-new route
 * created on the spot, or (when omitted) their current route. */
export type RouteTarget = { routeId: string } | { newRoute: { name: string; plannedDate: string | null } };

async function loadEligibleCompany(user: AuthenticatedUser, companyId: string) {
  const scope = companyScope(user);
  if (!scope) return { ok: false as const, error: "You do not have access to this company." };
  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope }, include: { leadType: true } });
  if (!company) return { ok: false as const, error: "Company not found or access denied." };
  return { ok: true as const, company };
}

function conflictDetail(outcome: RouteAddOutcome, currentLeadTypeName: string | null, currentCountry: string | null, company: { name: string; country: string; leadType: { name: string } }): RouteConflictDetail | null {
  switch (outcome.type) {
    case "ineligible":
      return { type: "ineligible", leadTypeName: company.leadType.name };
    case "lead_type_conflict":
      return { type: "lead_type_conflict", currentLeadTypeName: currentLeadTypeName ?? "", newLeadTypeName: company.leadType.name };
    case "country_conflict":
      return { type: "country_conflict", currentCountry: currentCountry ?? "", newCountry: company.country };
    case "ok":
      return null;
  }
}

/**
 * Adds one company to the signed-in user's active route — validates
 * eligibility/lead-type/country inside the same transaction that writes,
 * so a concurrent add from another tab can't slip a conflicting company in
 * between the check and the write. Idempotent: adding an already-present
 * company is a no-op success, not an error (relies on RoutePlanCompany's
 * real @@unique([routePlanId, companyId]) constraint catching a genuine
 * concurrent double-add race, rather than a check-then-insert that could
 * still race — same idempotency-via-DB-constraint pattern this codebase
 * already established for GeneratedReport, see MODULE_10_REPORT.md).
 */
export async function addCompanyToRoute(user: AuthenticatedUser, companyId: string, target?: RouteTarget): Promise<AddToRouteResult> {
  requirePermission(user, "manage_route_plan");

  const loaded = await loadEligibleCompany(user, companyId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { company } = loaded;

  let newRoute: { name: string; plannedDate: Date | null } | null = null;
  if (target && "newRoute" in target) {
    const fields = parseRouteFields(target.newRoute.name, target.newRoute.plannedDate);
    if (!fields.ok) return fields;
    newRoute = { name: fields.name, plannedDate: fields.plannedDate };
  }
  const targetRouteId = target && "routeId" in target ? target.routeId : null;
  let resolvedRouteId: string | null = null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      let route;
      if (newRoute) {
        route = await tx.routePlan.create({ data: { userId: user.id, name: newRoute.name, plannedDate: newRoute.plannedDate } });
        // A user's very first route becomes their current one.
        if (!(await activeRouteId(tx, user.id))) await tx.user.update({ where: { id: user.id }, data: { activeRoutePlanId: route.id } });
      } else {
        route = await resolveTargetRoute(tx, user.id, targetRouteId);
        if (!route) return { ok: false as const, error: "That route no longer exists." };
      }
      resolvedRouteId = route.id;
      const currentLeadType = route.leadTypeId ? await tx.leadType.findUnique({ where: { id: route.leadTypeId } }) : null;

      const outcome = resolveRouteAddOutcome(
        { leadTypeId: route.leadTypeId, country: route.country },
        { leadTypeId: company.leadTypeId, country: company.country, leadTypeRoutePlanEnabled: company.leadType.routePlanEnabled },
      );
      if (outcome.type !== "ok") {
        const detail = conflictDetail(outcome, currentLeadType?.name ?? null, route.country, company);
        return { ok: false as const, conflict: detail! };
      }

      if (route.leadTypeId === null) {
        await tx.routePlan.update({ where: { id: route.id }, data: { leadTypeId: company.leadTypeId, country: company.country } });
      }
      await tx.routePlanCompany.create({ data: { routePlanId: route.id, companyId, addedById: user.id } });
      const count = await tx.routePlanCompany.count({ where: { routePlanId: route.id } });
      return { ok: true as const, count, alreadyInRoute: false, routeName: route.name };
    });

    if (result.ok) {
      await writeAuditEvent({
        actorId: user.id,
        module: "route-plan",
        action: "route_plan.company_added",
        entityType: "Company",
        entityId: companyId,
        metadata: { count: result.count, routeId: resolvedRouteId, routeName: result.routeName },
      });
    }
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && resolvedRouteId) {
      const route = await prisma.routePlan.findUnique({ where: { id: resolvedRouteId }, include: { _count: { select: { companies: true } } } });
      return { ok: true, count: route?._count.companies ?? 0, alreadyInRoute: true, routeName: route?.name ?? "" };
    }
    throw error;
  }
}

/** Removes a company from one of the user's routes (by id), or from their
 * current route when no id is given. */
export async function removeCompanyFromRoute(user: AuthenticatedUser, companyId: string, routeId?: string | null): Promise<{ count: number }> {
  requirePermission(user, "manage_route_plan");

  const resolvedId = routeId
    ? ((await prisma.routePlan.findFirst({ where: { id: routeId, userId: user.id }, select: { id: true } }))?.id ?? null)
    : await activeRouteId(prisma, user.id);
  if (!resolvedId) return { count: 0 };
  const route = { id: resolvedId };

  // deleteMany (not delete) so removing a company that's already gone from
  // the route — e.g. a duplicate click, or another tab already removed it —
  // is a silent no-op instead of a thrown not-found error.
  await prisma.routePlanCompany.deleteMany({ where: { routePlanId: route.id, companyId } });
  const count = await prisma.routePlanCompany.count({ where: { routePlanId: route.id } });

  await writeAuditEvent({ actorId: user.id, module: "route-plan", action: "route_plan.company_removed", entityType: "Company", entityId: companyId, metadata: { count } });
  return { count };
}

/**
 * Clears every company from the current route and resets its established
 * lead type/country back to null (so the *next* company added — of any
 * eligible lead type/country — establishes it fresh), but keeps the route
 * itself (its name and date) — deleteRoute() removes a route entirely.
 */
export async function clearRoute(user: AuthenticatedUser): Promise<void> {
  requirePermission(user, "manage_route_plan");

  const routeId = await activeRouteId(prisma, user.id);
  if (!routeId) return;
  const route = { id: routeId };

  const clearedCount = await prisma.routePlanCompany.count({ where: { routePlanId: route.id } });
  await prisma.$transaction([
    prisma.routePlanCompany.deleteMany({ where: { routePlanId: route.id } }),
    prisma.routePlan.update({ where: { id: route.id }, data: { leadTypeId: null, country: null } }),
  ]);

  await writeAuditEvent({ actorId: user.id, module: "route-plan", action: "route_plan.cleared", entityType: "RoutePlan", entityId: route.id, metadata: { clearedCount } });
}

export type BulkAddResult =
  | { ok: true; addedCount: number; alreadyInRouteCount: number }
  | { ok: false; conflict: RouteConflictDetail }
  | { ok: false; perCompanyErrors: Record<string, string> };

/**
 * Bulk add is all-or-nothing at the ROUTE level (spec 4.3: "do not
 * partially change the active route until the user chooses how to handle
 * the conflict") — every candidate is validated for scope/existence AND
 * for eligibility/lead-type/country match against the CURRENT route state
 * (plus every other candidate already accepted in this same batch) before
 * anything is written; the whole batch commits in one transaction or
 * nothing does. A per-company scope/not-found failure is reported back
 * per-company rather than blocking the whole batch on a single bad id —
 * that's a different failure class from a route-level conflict, which by
 * definition affects the entire batch identically.
 */
export async function bulkAddCompaniesToRoute(user: AuthenticatedUser, companyIds: string[]): Promise<BulkAddResult> {
  requirePermission(user, "manage_route_plan");
  requirePermission(user, "bulk_update_leads");

  const scope = companyScope(user);
  if (!scope) return { ok: false, perCompanyErrors: Object.fromEntries(companyIds.map((id) => [id, "You do not have access to this company."])) };

  const companies = await prisma.company.findMany({ where: { id: { in: companyIds }, ...scope }, include: { leadType: true } });
  const foundIds = new Set(companies.map((c) => c.id));
  const perCompanyErrors: Record<string, string> = {};
  for (const id of companyIds) {
    if (!foundIds.has(id)) perCompanyErrors[id] = "Company not found or access denied.";
  }

  const result = await prisma.$transaction(async (tx) => {
    const route = await ensureActiveRoute(tx, user.id);
    const existingCompanyIds = new Set((await tx.routePlanCompany.findMany({ where: { routePlanId: route.id }, select: { companyId: true } })).map((r) => r.companyId));

    let routeLeadTypeId = route.leadTypeId;
    let routeCountry = route.country;
    const toAdd: string[] = [];
    let alreadyInRouteCount = 0;

    for (const company of companies) {
      if (existingCompanyIds.has(company.id)) {
        alreadyInRouteCount++;
        continue;
      }
      const outcome = resolveRouteAddOutcome(
        { leadTypeId: routeLeadTypeId, country: routeCountry },
        { leadTypeId: company.leadTypeId, country: company.country, leadTypeRoutePlanEnabled: company.leadType.routePlanEnabled },
      );
      if (outcome.type !== "ok") {
        const currentLeadType = routeLeadTypeId ? await tx.leadType.findUnique({ where: { id: routeLeadTypeId } }) : null;
        return { ok: false as const, conflict: conflictDetail(outcome, currentLeadType?.name ?? null, routeCountry, company)! };
      }
      // Establish from the first eligible candidate in the batch, so every
      // subsequent candidate in the same batch is checked against it too —
      // not just against the route's state as it was before this batch
      // started.
      if (routeLeadTypeId === null) {
        routeLeadTypeId = company.leadTypeId;
        routeCountry = company.country;
      }
      toAdd.push(company.id);
    }

    if (route.leadTypeId === null && routeLeadTypeId !== null) {
      await tx.routePlan.update({ where: { id: route.id }, data: { leadTypeId: routeLeadTypeId, country: routeCountry } });
    }
    if (toAdd.length > 0) {
      await tx.routePlanCompany.createMany({ data: toAdd.map((companyId) => ({ routePlanId: route.id, companyId, addedById: user.id })) });
    }
    return { ok: true as const, addedCount: toAdd.length, alreadyInRouteCount };
  });

  if (result.ok) {
    await writeAuditEvent({ actorId: user.id, module: "route-plan", action: "route_plan.bulk_added", entityType: "RoutePlan", metadata: { addedCount: result.addedCount, alreadyInRouteCount: result.alreadyInRouteCount } });
    if (Object.keys(perCompanyErrors).length > 0) {
      return { ok: false, perCompanyErrors };
    }
  }
  return result;
}

export type RouteCompanyRow = {
  id: string;
  name: string;
  /** Street, city, province/state, postal/ZIP — no country (see
   * formatRouteAddress). Pre-computed here rather than in the UI so the
   * page and the CSV export share one formatting pass, not two. */
  formattedAddress: string;
  missingAddressFields: string[];
  /** Revalidated against the route's established lead type/country at read
   * time (spec 13: "If a selected company no longer matches the route's
   * lead type or country, flag it as invalid") — a company's own lead type
   * or country can change after it was added. */
  stillValid: boolean;
};

export type RouteDetail = {
  route: RouteSummary;
  companies: RouteCompanyRow[];
  /** Precomputed here (not just inside exportRoutePlanCsv) so the Route
   * Plan page's export-confirmation dialog can show the exact filename
   * before generation, per spec 9 — null when the lead type has no
   * routePlanSlug configured yet, which the UI surfaces as "ask an
   * administrator" rather than a broken/blank filename. */
  exportFilename: string | null;
};

/** The Route Plan page's (and the CSV export's) single source of truth —
 * always reads current company data, never a stale snapshot from when each
 * company was added. */
export async function getRouteDetail(user: AuthenticatedUser): Promise<RouteDetail> {
  const scope = companyScope(user);
  if (!scope) return { route: EMPTY_SUMMARY, companies: [], exportFilename: null };

  const routeId = await activeRouteId(prisma, user.id);
  if (!routeId) return { route: EMPTY_SUMMARY, companies: [], exportFilename: null };
  const route = await prisma.routePlan.findUnique({
    where: { id: routeId },
    include: {
      leadType: true,
      // Filtered through the real companyScope() WHERE clause, not a
      // hand-rolled re-implementation of it — a company that fell outside
      // the user's scope since being added (reassigned, team change) is
      // excluded from the review/export view, matching companyScope's
      // "never silently act on a forbidden id" rule everywhere else.
      companies: { where: { company: scope }, include: { company: { include: { leadType: true } } } },
    },
  });
  if (!route) return { route: EMPTY_SUMMARY, companies: [], exportFilename: null };

  const rows: RouteCompanyRow[] = route.companies.map((entry) => ({
    id: entry.company.id,
    name: entry.company.name,
    formattedAddress: formatRouteAddress(entry.company),
    missingAddressFields: missingRouteAddressFields(entry.company),
    stillValid: entry.company.leadTypeId === route.leadTypeId && normalizeCountry(entry.company.country) === normalizeCountry(route.country ?? ""),
  }));

  return {
    route: {
      id: route.id,
      name: route.name,
      plannedDate: isoDate(route.plannedDate),
      count: rows.length,
      leadTypeId: route.leadTypeId,
      leadTypeName: route.leadType?.name ?? null,
      country: route.country,
    },
    companies: sortRouteCompanies(rows),
    // Dated by the route's planned day when it has one (e.g. Friday's
    // Hamilton route), else today; the route name goes in too, so several
    // exported routes don't overwrite each other in Downloads.
    exportFilename: route.leadType?.routePlanSlug
      ? buildRoutePlanFilename(route.leadType.routePlanSlug, route.plannedDate ? utcCalendarDate(route.plannedDate) : zonedCalendarDate(new Date()), route.name)
      : null,
  };
}

function utcCalendarDate(date: Date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export type ExportRoutePlanResult = { ok: true; csv: string; filename: string; count: number } | { ok: false; error: string };

const CSV_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "address", label: "Address" },
];

/**
 * Generates the EZRoutePlanner-compatible CSV — exactly two columns
 * (Name,Address), reusing buildCsv() (already handles quoting/escaping AND
 * OWASP formula-injection neutralization on every cell — see src/lib/
 * export/serialize.ts, the same function src/app/api/export/companies
 * uses). Blocks on a `stillValid: false` row (spec 13: "flag it as invalid
 * and prevent silent inclusion... until the user removes it") rather than
 * silently dropping it from the export or silently including it — no
 * repair action is defined for this release, so the only safe move is to
 * make the user deal with it first. Incomplete addresses are NOT blocked
 * here (spec explicitly allows exporting them after a UI acknowledgment —
 * that acknowledgment is a client-side confirmation step, not something
 * this stateless server call can itself verify happened).
 */
export async function exportRoutePlanCsv(user: AuthenticatedUser): Promise<ExportRoutePlanResult> {
  requirePermission(user, "export_route_plan");

  const detail = await getRouteDetail(user);
  if (detail.companies.length === 0) {
    return { ok: false, error: "This route is empty — add companies before exporting." };
  }

  const invalidRows = detail.companies.filter((c) => !c.stillValid);
  if (invalidRows.length > 0) {
    return {
      ok: false,
      error: `${invalidRows.length} compan${invalidRows.length === 1 ? "y" : "ies"} in this route no longer match its lead type or country — remove ${invalidRows.length === 1 ? "it" : "them"} before exporting.`,
    };
  }

  if (!detail.exportFilename) {
    return { ok: false, error: "This lead type has no Route Plan filename configured yet — ask an administrator to set one in Settings > Lead Types." };
  }

  const rows = detail.companies.map((c) => ({ name: c.name, address: c.formattedAddress }));
  const csv = buildCsv(CSV_COLUMNS, rows);

  await writeAuditEvent({
    actorId: user.id,
    module: "route-plan",
    action: "route_plan.exported",
    entityType: "RoutePlan",
    entityId: detail.route.id ?? undefined,
    metadata: { count: detail.companies.length, routeName: detail.route.name, leadTypeName: detail.route.leadTypeName, country: detail.route.country, filename: detail.exportFilename },
  });

  return { ok: true, csv, filename: detail.exportFilename, count: detail.companies.length };
}
