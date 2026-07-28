// Pure, DB-free logic for the Route Plan feature — address formatting/
// completeness, country matching, filename/slug rules, and sort order. Kept
// separate from src/lib/route-plan/service.ts (which does the DB-backed
// establish/add/remove/conflict work) so every rule here is directly
// unit-testable without a database.

export type RouteAddressInput = {
  address1: string | null;
  city: string;
  region: string;
  postalCode: string | null;
};

/**
 * "Canada" vs "canada" vs " Canada " must compare equal when deciding
 * whether a company matches the route's established country — Company.
 * country is completely free text (no code list, no normalizedCountry
 * field exists anywhere in this app). Deliberately simple (trim + case
 * fold only, no country-name-to-code mapping table): confirmed with the
 * account holder that country values in practice are just two flat
 * strings ("USA" and "CA"), not full country names needing real alias
 * resolution the way normalizeRegion's US-states table does.
 */
export function normalizeCountry(country: string): string {
  return country.trim().toLowerCase();
}

/**
 * Street, city, province/state, postal/ZIP — country deliberately excluded
 * (the spec requires every route to be single-country, so it adds no
 * information to the exported address). Empty components are omitted
 * rather than producing repeated/leading/trailing commas; never emits the
 * literal strings "null" or "undefined" for a missing field.
 */
export function formatRouteAddress(company: RouteAddressInput): string {
  const parts = [company.address1, company.city, company.region, company.postalCode]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0));
  return parts.join(", ");
}

export type MissingRouteAddressField = "street address" | "postal/ZIP code";

/**
 * city/region/country are schema-required on Company (never blank) — only
 * address1 and postalCode are nullable, so those are the only two fields
 * that can actually be "missing" here. Order matches the address's own
 * left-to-right order.
 */
export function missingRouteAddressFields(company: RouteAddressInput): MissingRouteAddressField[] {
  const missing: MissingRouteAddressField[] = [];
  if (!company.address1?.trim()) missing.push("street address");
  if (!company.postalCode?.trim()) missing.push("postal/ZIP code");
  return missing;
}

export function isRouteAddressComplete(company: RouteAddressInput): boolean {
  return missingRouteAddressFields(company).length === 0;
}

/**
 * Case-insensitive by company name (locale-aware via localeCompare,
 * matching the database/application's existing convention elsewhere for
 * user-facing sort — e.g. Prisma orderBy: { name: "asc" } already collates
 * this way in Postgres's default locale), company ID as the stable
 * secondary sort so two identically-named companies always sort in the
 * same relative order across renders/exports rather than however the
 * underlying query happened to return them.
 */
export function sortRouteCompanies<T extends { id: string; name: string }>(companies: T[]): T[] {
  return [...companies].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** Filename-safe: lowercase letters, digits, and hyphens only, no leading/
 * trailing/repeated hyphens. Used both to validate an admin-entered
 * LeadType.routePlanSlug and to suggest a starting value from the lead
 * type's name in the settings form — the stored value is always explicit
 * (never silently re-derived at export time), so a later rename can't
 * retroactively change an already-configured slug. */
export function sanitizeRoutePlanSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type RouteAddOutcome =
  | { type: "ineligible" }
  | { type: "lead_type_conflict" }
  | { type: "country_conflict" }
  | { type: "ok" };

/**
 * Pure decision core for "can this company be added to this route right
 * now" — src/lib/route-plan/service.ts is the DB-wired caller. Eligibility
 * is checked FIRST and unconditionally (spec 5.4: "Do not offer to replace
 * the current route because eligibility is the first failure" — an
 * ineligible lead type is never a route-level conflict to resolve, it's a
 * flat no). An empty route (leadTypeId/country both null) always accepts an
 * eligible company, since that's the "first company establishes the route"
 * case handled by the caller, not a conflict here.
 */
export function resolveRouteAddOutcome(
  route: { leadTypeId: string | null; country: string | null },
  company: { leadTypeId: string; country: string; leadTypeRoutePlanEnabled: boolean },
): RouteAddOutcome {
  if (!company.leadTypeRoutePlanEnabled) return { type: "ineligible" };
  if (route.leadTypeId === null || route.country === null) return { type: "ok" };
  if (company.leadTypeId !== route.leadTypeId) return { type: "lead_type_conflict" };
  if (normalizeCountry(company.country) !== normalizeCountry(route.country)) return { type: "country_conflict" };
  return { type: "ok" };
}

/** <slug>-route-YYYY-MM-DD.csv — no time component. `date` is expected to
 * already be resolved in the business timezone (see zonedCalendarDate in
 * src/lib/timezone.ts), not computed here, so this function stays pure and
 * doesn't need a Date/timezone parameter. */
export function buildRoutePlanFilename(leadTypeSlug: string, date: { year: number; month: number; day: number }): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${leadTypeSlug}-route-${date.year}-${mm}-${dd}.csv`;
}
