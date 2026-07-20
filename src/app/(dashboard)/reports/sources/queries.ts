import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope } from "@/lib/reports/scope";
import { resolveReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { computeRate } from "@/lib/reports/metrics";

const SOURCE_LABELS: Record<string, string> = { MANUAL: "Manual", AI_RESEARCH: "AI Research", IMPORT: "Import" };
const SOURCE_KEYS = ["MANUAL", "AI_RESEARCH", "IMPORT"] as const;

export async function getSourcesReport(user: AuthenticatedUser, filters: ReportFilters) {
  const scope = reportScope(user);
  if (!scope) return null;

  const { dateRange, companyWhere } = await resolveReportFilters(filters, scope);
  const createdInRangeWhere = { AND: [companyWhere, { createdAt: { gte: dateRange.start, lt: dateRange.end } }] };

  const [countGroups, unknownCount, decidedInRange] = await Promise.all([
    prisma.company.groupBy({ by: ["source"], where: createdInRangeWhere, _count: true }),
    prisma.company.count({ where: { AND: [companyWhere, { createdAt: { gte: dateRange.start, lt: dateRange.end } }, { source: null }] } }),
    prisma.pipelineStageHistory.findMany({
      where: {
        changedAt: { gte: dateRange.start, lt: dateRange.end },
        toStage: { outcomeType: { in: ["WON", "LOST"] } },
        company: companyWhere,
      },
      select: { toStageId: true, company: { select: { source: true } }, toStage: { select: { outcomeType: true } } },
    }),
  ]);

  const countBySource = new Map(countGroups.filter((g) => g.source !== null).map((g) => [g.source as string, g._count]));

  const rows = SOURCE_KEYS.map((key) => ({ label: SOURCE_LABELS[key], count: countBySource.get(key) ?? 0 }));
  if (unknownCount > 0) rows.push({ label: "Unknown (created before Module Five)", count: unknownCount });

  const winRateBySource = SOURCE_KEYS.map((key) => {
    const rowsForKey = decidedInRange.filter((r) => r.company.source === key);
    const won = rowsForKey.filter((r) => r.toStage.outcomeType === "WON").length;
    return { label: SOURCE_LABELS[key], result: computeRate(won, rowsForKey.length) };
  });

  return { rows, winRateBySource };
}
