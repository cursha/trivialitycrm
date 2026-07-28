import "server-only";
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
  count: number;
  leadTypeId: string | null;
  leadTypeName: string | null;
  country: string | null;
};

/** The header badge count and page title need this on effectively every
 * page load — cheap (one row + a count), so no caching beyond Next's own
 * per-request dedup. Creates nothing: an empty summary for a user who has
 * never opened Route Plan is just zeros, not a DB write. */
export async function getRouteSummary(userId: string): Promise<RouteSummary> {
  const route = await prisma.routePlan.findUnique({
    where: { userId },
    include: { leadType: true, _count: { select: { companies: true } } },
  });
  if (!route) return { count: 0, leadTypeId: null, leadTypeName: null, country: null };
  return {
    count: route._count.companies,
    leadTypeId: route.leadTypeId,
    leadTypeName: route.leadType?.name ?? null,
    country: route.country,
  };
}

/** Set of company IDs currently in the user's active route — used to render
 * "already in route" state on the company profile and list, distinct from
 * (and never confused with) a bulk-action page-selection checkbox. */
export async function getRouteCompanyIds(userId: string): Promise<Set<string>> {
  const route = await prisma.routePlan.findUnique({ where: { userId }, select: { companies: { select: { companyId: true } } } });
  return new Set(route?.companies.map((c) => c.companyId) ?? []);
}

export type RouteConflictDetail =
  | { type: "ineligible"; leadTypeName: string }
  | { type: "lead_type_conflict"; currentLeadTypeName: string; newLeadTypeName: string }
  | { type: "country_conflict"; currentCountry: string; newCountry: string };

export type AddToRouteResult = { ok: true; count: number; alreadyInRoute: boolean } | { ok: false; error: string } | { ok: false; conflict: RouteConflictDetail };

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
export async function addCompanyToRoute(user: AuthenticatedUser, companyId: string): Promise<AddToRouteResult> {
  requirePermission(user, "manage_route_plan");

  const loaded = await loadEligibleCompany(user, companyId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { company } = loaded;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const route = await tx.routePlan.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
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
      return { ok: true as const, count, alreadyInRoute: false };
    });

    if (result.ok) {
      await writeAuditEvent({ actorId: user.id, module: "route-plan", action: "route_plan.company_added", entityType: "Company", entityId: companyId, metadata: { count: result.count } });
    }
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const count = await prisma.routePlanCompany.count({ where: { routePlan: { userId: user.id } } });
      return { ok: true, count, alreadyInRoute: true };
    }
    throw error;
  }
}

export async function removeCompanyFromRoute(user: AuthenticatedUser, companyId: string): Promise<{ count: number }> {
  requirePermission(user, "manage_route_plan");

  const route = await prisma.routePlan.findUnique({ where: { userId: user.id } });
  if (!route) return { count: 0 };

  // deleteMany (not delete) so removing a company that's already gone from
  // the route — e.g. a duplicate click, or another tab already removed it —
  // is a silent no-op instead of a thrown not-found error.
  await prisma.routePlanCompany.deleteMany({ where: { routePlanId: route.id, companyId } });
  const count = await prisma.routePlanCompany.count({ where: { routePlanId: route.id } });

  await writeAuditEvent({ actorId: user.id, module: "route-plan", action: "route_plan.company_removed", entityType: "Company", entityId: companyId, metadata: { count } });
  return { count };
}

/**
 * Clears every company from the active route and resets its established
 * lead type/country back to null (so the *next* company added — of any
 * eligible lead type/country — establishes it fresh), but keeps the
 * RoutePlan row itself rather than deleting it (userId stays @unique-bound
 * to exactly one row for the life of the user, simpler than recreating it
 * on every next add).
 */
export async function clearRoute(user: AuthenticatedUser): Promise<void> {
  requirePermission(user, "manage_route_plan");

  const route = await prisma.routePlan.findUnique({ where: { userId: user.id } });
  if (!route) return;

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
    const route = await tx.routePlan.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
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
  if (!scope) return { route: { count: 0, leadTypeId: null, leadTypeName: null, country: null }, companies: [], exportFilename: null };

  const route = await prisma.routePlan.findUnique({
    where: { userId: user.id },
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
  if (!route) return { route: { count: 0, leadTypeId: null, leadTypeName: null, country: null }, companies: [], exportFilename: null };

  const rows: RouteCompanyRow[] = route.companies.map((entry) => ({
    id: entry.company.id,
    name: entry.company.name,
    formattedAddress: formatRouteAddress(entry.company),
    missingAddressFields: missingRouteAddressFields(entry.company),
    stillValid: entry.company.leadTypeId === route.leadTypeId && normalizeCountry(entry.company.country) === normalizeCountry(route.country ?? ""),
  }));

  return {
    route: { count: rows.length, leadTypeId: route.leadTypeId, leadTypeName: route.leadType?.name ?? null, country: route.country },
    companies: sortRouteCompanies(rows),
    exportFilename: route.leadType?.routePlanSlug ? buildRoutePlanFilename(route.leadType.routePlanSlug, zonedCalendarDate(new Date())) : null,
  };
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
    return { ok: false, error: "Your Route Plan is empty — add companies before exporting." };
  }

  const invalidRows = detail.companies.filter((c) => !c.stillValid);
  if (invalidRows.length > 0) {
    return {
      ok: false,
      error: `${invalidRows.length} compan${invalidRows.length === 1 ? "y" : "ies"} in your Route Plan no longer match its lead type or country — remove ${invalidRows.length === 1 ? "it" : "them"} before exporting.`,
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
    metadata: { count: detail.companies.length, leadTypeName: detail.route.leadTypeName, country: detail.route.country, filename: detail.exportFilename },
  });

  return { ok: true, csv, filename: detail.exportFilename, count: detail.companies.length };
}
