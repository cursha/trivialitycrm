// Module Ten: global cross-entity search — no such thing existed before
// this (confirmed by research; the only prior "search" was per-list
// filtering on the companies list page). Reuses companyScope() exactly as
// every other company/contact query in this app does — this is the single
// most important thing to get right here, since a naive implementation
// could leak records outside a Salesperson's assignment/team.
//
// No `import "server-only"` — matches every other query module in this
// codebase that only Server Actions/pages call; kept consistent rather than
// gatekeeping this one file differently. The constant/types a client
// component needs live in ./global-search-types instead, specifically so a
// client component never has a reason to import *this* file (which does
// import prisma at module scope) — see that file's header comment.
import { prisma } from "../prisma";
import { companyScope } from "../companies/scope";
import type { AuthenticatedUser } from "../auth/current-user";
import { MIN_QUERY_LENGTH, type GlobalSearchResult, type GlobalSearchResults } from "./global-search-types";

export { MIN_QUERY_LENGTH, type GlobalSearchResult, type GlobalSearchResults };

const RESULTS_PER_TYPE = 8;

const EMPTY_RESULTS: GlobalSearchResults = { companies: [], contacts: [], competitors: [] };

/**
 * Cross-entity search — Company (name/city/region/postal/phone/email/
 * website), Contact (name/email/phone, joined through companyScope via its
 * company relation), Competitor (name). Every result type is independently
 * capped and grouped, never a single flat ranked list, so the caller can
 * render "Companies (3)" / "Contacts (2)" sections. MERGED companies/
 * contacts are excluded (tombstoned, superseded by another record) —
 * ARCHIVED companies are deliberately included, since a user searching by
 * name/phone wants to *find* the record regardless of its lifecycle state;
 * companyScope (not status) is the real access boundary.
 */
export async function globalSearch(user: AuthenticatedUser, rawQuery: string): Promise<GlobalSearchResults> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_LENGTH) return EMPTY_RESULTS;

  const scope = companyScope(user);
  if (!scope) return EMPTY_RESULTS;

  const contains = { contains: query, mode: "insensitive" as const };

  const [companies, contacts, competitors] = await Promise.all([
    prisma.company.findMany({
      where: {
        AND: [
          scope,
          { status: { not: "MERGED" } },
          { OR: [{ name: contains }, { city: contains }, { region: contains }, { postalCode: contains }, { phone: contains }, { email: contains }, { websiteUrl: contains }] },
        ],
      },
      select: { id: true, name: true, city: true, region: true, status: true },
      orderBy: { name: "asc" },
      take: RESULTS_PER_TYPE,
    }),
    prisma.contact.findMany({
      where: {
        status: { not: "MERGED" },
        company: scope,
        OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }],
      },
      select: { id: true, firstName: true, lastName: true, email: true, companyId: true, company: { select: { name: true } } },
      orderBy: { firstName: "asc" },
      take: RESULTS_PER_TYPE,
    }),
    prisma.competitor.findMany({
      where: { active: true, name: contains },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: RESULTS_PER_TYPE,
    }),
  ]);

  return {
    companies: companies.map((c) => ({
      type: "company" as const,
      id: c.id,
      title: c.name,
      subtitle: c.status === "ARCHIVED" ? `${c.city}, ${c.region} — Archived` : `${c.city}, ${c.region}`,
      href: `/companies/${c.id}`,
    })),
    contacts: contacts.map((c) => ({
      type: "contact" as const,
      id: c.id,
      title: `${c.firstName} ${c.lastName}`.trim(),
      subtitle: c.email ? `${c.company.name} — ${c.email}` : c.company.name,
      href: `/companies/${c.companyId}`,
    })),
    competitors: competitors.map((c) => ({
      type: "competitor" as const,
      id: c.id,
      title: c.name,
      subtitle: "Competitor",
      href: `/competitors`,
    })),
  };
}
