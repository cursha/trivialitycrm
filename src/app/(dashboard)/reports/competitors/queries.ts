import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope } from "@/lib/reports/scope";
import { resolveReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { hasPermission } from "@/lib/auth/permissions";

/** Every total here is computed live from Company.competitorId — there is
 * no separate stored "competitor count," matching the brief's "must be
 * computed from linked records, not manually entered." */
export async function getCompetitorsReport(user: AuthenticatedUser, filters: ReportFilters) {
  const scope = reportScope(user);
  if (!scope) return null;
  if (!hasPermission(user, "view_competitor_reports")) return { forbidden: true as const };

  const { dateRange, companyWhere } = await resolveReportFilters(filters, scope);
  const activeStatus = (filters.status ?? "ACTIVE") as "ACTIVE" | "ARCHIVED";

  const [competitors, linkedGroups, decidedInRange] = await Promise.all([
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.company.groupBy({
      by: ["competitorId"],
      where: { AND: [companyWhere, { status: activeStatus }, { competitorId: { not: null } }] },
      _count: true,
    }),
    prisma.pipelineStageHistory.findMany({
      where: {
        changedAt: { gte: dateRange.start, lt: dateRange.end },
        toStage: { outcomeType: { in: ["WON", "LOST"] } },
        company: { AND: [companyWhere, { competitorId: { not: null } }] },
      },
      select: { company: { select: { competitorId: true } }, toStage: { select: { outcomeType: true } } },
    }),
  ]);

  const linkedCountById = new Map(linkedGroups.filter((g) => g.competitorId !== null).map((g) => [g.competitorId as string, g._count]));
  const wonById = new Map<string, number>();
  const lostById = new Map<string, number>();
  for (const row of decidedInRange) {
    const id = row.company.competitorId;
    if (!id) continue;
    if (row.toStage.outcomeType === "WON") wonById.set(id, (wonById.get(id) ?? 0) + 1);
    else lostById.set(id, (lostById.get(id) ?? 0) + 1);
  }

  const rows = competitors.map((c) => ({
    competitorId: c.id,
    name: c.name,
    linkedLeads: linkedCountById.get(c.id) ?? 0,
    wonInRange: wonById.get(c.id) ?? 0,
    lostInRange: lostById.get(c.id) ?? 0,
  }));

  return { forbidden: false as const, rows };
}
