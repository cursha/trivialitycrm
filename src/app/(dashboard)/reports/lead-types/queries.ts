import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope } from "@/lib/reports/scope";
import { resolveReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { computeRate } from "@/lib/reports/metrics";

/** Every label here comes from the admin-editable LeadType table — never a
 * hardcoded list of type names. */
export async function getLeadTypesReport(user: AuthenticatedUser, filters: ReportFilters) {
  const scope = reportScope(user);
  if (!scope) return null;

  const { dateRange, companyWhere } = await resolveReportFilters(filters, scope);
  const activeStatus = (filters.status ?? "ACTIVE") as "ACTIVE" | "ARCHIVED";

  const [leadTypes, countGroups, decidedInRange] = await Promise.all([
    prisma.leadType.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.company.groupBy({ by: ["leadTypeId"], where: { AND: [companyWhere, { status: activeStatus }] }, _count: true }),
    prisma.pipelineStageHistory.findMany({
      where: { changedAt: { gte: dateRange.start, lt: dateRange.end }, toStage: { outcomeType: { in: ["WON", "LOST"] } }, company: companyWhere },
      select: { company: { select: { leadTypeId: true } }, toStage: { select: { outcomeType: true } } },
    }),
  ]);

  const countById = new Map(countGroups.map((g) => [g.leadTypeId, g._count]));
  const rows = leadTypes.map((t) => ({ leadTypeId: t.id, label: t.name, count: countById.get(t.id) ?? 0 }));

  const winRateByLeadType = leadTypes.map((t) => {
    const rowsForType = decidedInRange.filter((r) => r.company.leadTypeId === t.id);
    const won = rowsForType.filter((r) => r.toStage.outcomeType === "WON").length;
    return { label: t.name, result: computeRate(won, rowsForType.length) };
  });

  return { rows, winRateByLeadType };
}
