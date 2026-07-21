// No `import "server-only"` — the worker (via src/lib/reports/build-rows.ts)
// needs this module too; see src/lib/prisma.ts for the same reasoning.
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope } from "@/lib/reports/scope";
import { resolveReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { matchTerritory } from "@/lib/workspace/territory-match";

/**
 * Every count here is a live match against Company location fields (via the
 * same matchTerritory specificity rule Module Four's pipeline filter uses),
 * never a stored per-territory tally. A territory with zero matches is
 * reported as "no recorded leads" — the brief is explicit that this must
 * never be read as "no prospects exist there," just "none are in the CRM
 * yet."
 */
export async function getTerritoriesReport(user: AuthenticatedUser, filters: ReportFilters) {
  const scope = reportScope(user);
  if (!scope) return null;

  const { dateRange, companyWhere } = await resolveReportFilters(filters, scope);
  const activeStatus = (filters.status ?? "ACTIVE") as "ACTIVE" | "ARCHIVED";

  const [territories, companies, wonLostRows] = await Promise.all([
    prisma.territory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.company.findMany({
      where: { AND: [companyWhere, { status: activeStatus }] },
      select: { id: true, country: true, region: true, city: true },
    }),
    prisma.pipelineStageHistory.findMany({
      where: {
        changedAt: { gte: dateRange.start, lt: dateRange.end },
        toStage: { outcomeType: { in: ["WON", "LOST"] } },
        company: companyWhere,
      },
      select: {
        toStage: { select: { outcomeType: true } },
        company: { select: { id: true, country: true, region: true, city: true } },
      },
    }),
  ]);

  const territoryCandidates = territories.map((t) => ({ id: t.id, name: t.name, country: t.country, region: t.region, city: t.city }));

  const countByTerritoryId = new Map<string, number>();
  let unmatched = 0;
  for (const company of companies) {
    const match = matchTerritory({ country: company.country, region: company.region, city: company.city }, territoryCandidates);
    if (match) countByTerritoryId.set(match.id, (countByTerritoryId.get(match.id) ?? 0) + 1);
    else unmatched += 1;
  }

  const wonByTerritoryId = new Map<string, number>();
  const lostByTerritoryId = new Map<string, number>();
  for (const row of wonLostRows) {
    const match = matchTerritory(
      { country: row.company.country, region: row.company.region, city: row.company.city },
      territoryCandidates,
    );
    if (!match) continue;
    const bucket = row.toStage.outcomeType === "WON" ? wonByTerritoryId : lostByTerritoryId;
    bucket.set(match.id, (bucket.get(match.id) ?? 0) + 1);
  }

  const rows = territories.map((t) => ({
    territoryId: t.id,
    name: t.name ?? [t.city, t.region, t.country].filter(Boolean).join(", "),
    leadCount: countByTerritoryId.get(t.id) ?? 0,
    wonInRange: wonByTerritoryId.get(t.id) ?? 0,
    lostInRange: lostByTerritoryId.get(t.id) ?? 0,
  }));

  return { rows, unmatched };
}
