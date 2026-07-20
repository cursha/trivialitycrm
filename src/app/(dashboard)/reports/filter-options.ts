import "server-only";
import { prisma } from "@/lib/prisma";

/** One shared fetch for the option lists every report filter bar needs —
 * called once per page instead of duplicating five near-identical Prisma
 * calls across nine report pages. */
export async function getReportFilterOptions() {
  const [leadTypes, pipelineStages, salespeople, competitors, territories] = await Promise.all([
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.territory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  return {
    leadTypes,
    pipelineStages,
    salespeople,
    competitors,
    territories: territories.map((t) => ({ id: t.id, name: t.name ?? [t.city, t.region, t.country].filter(Boolean).join(", ") })),
  };
}

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Every report page parses its raw searchParams into a validated
 * ReportFilters through this one function, so no page can accidentally
 * skip server-side validation of a filter value before it reaches a Prisma
 * query. */
export function rawFiltersFromParams(params: Record<string, string | string[] | undefined>) {
  return {
    dateRange: toSingle(params.dateRange) || "month",
    customFrom: toSingle(params.customFrom) || undefined,
    customTo: toSingle(params.customTo) || undefined,
    territoryId: toSingle(params.territoryId) || undefined,
    leadTypeId: toSingle(params.leadTypeId) || undefined,
    pipelineStageId: toSingle(params.pipelineStageId) || undefined,
    assignedToId: toSingle(params.assignedToId) || undefined,
    source: toSingle(params.source) || undefined,
    competitorId: toSingle(params.competitorId) || undefined,
    scoreMin: toSingle(params.scoreMin) ? Number(toSingle(params.scoreMin)) : undefined,
    scoreMax: toSingle(params.scoreMax) ? Number(toSingle(params.scoreMax)) : undefined,
    triviaStatus: toSingle(params.triviaStatus) || undefined,
    status: toSingle(params.status) || undefined,
    outcome: toSingle(params.outcome) || undefined,
    country: toSingle(params.country) || undefined,
    region: toSingle(params.region) || undefined,
    city: toSingle(params.city) || undefined,
  };
}
