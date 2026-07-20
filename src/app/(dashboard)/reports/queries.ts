import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope, reportTaskWhere, reportUserWhere } from "@/lib/reports/scope";
import { resolveReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { daysAgo } from "@/lib/dates";

/**
 * The Reporting Dashboard's 19 summary metrics. Every count here is either
 * a plain scoped Prisma count/groupBy (Postgres-side aggregation, never a
 * full-table load into Node) or, for the two "latest activity per company"
 * metrics, a `distinct` + matching `orderBy` query — Prisma's documented
 * pattern for "one row per group, picked by ordering" — followed only by a
 * lightweight per-id comparison, not a scan of full activity rows.
 * See REPORT_DEFINITIONS.md's "Dashboard summary metrics" section for the
 * numerator/denominator/date-field/permission-scope of every metric below.
 */
export async function getDashboardMetrics(user: AuthenticatedUser, filters: ReportFilters, noActivityThresholdDays: number) {
  const scope = reportScope(user);
  if (!scope) return null;

  const { dateRange, companyWhere: companyScopeWhere } = await resolveReportFilters(filters, scope);
  const activeWhere = { AND: [companyScopeWhere, { status: (filters.status ?? "ACTIVE") as "ACTIVE" | "ARCHIVED" }] };
  const createdInRangeWhere = { AND: [companyScopeWhere, { createdAt: { gte: dateRange.start, lt: dateRange.end } }] };
  const now = new Date();

  const [
    newLeads,
    manualLeads,
    aiLeads,
    importedLeads,
    activeLeads,
    unassignedLeads,
    archivedInRange,
    pipelineGroups,
    stages,
    overdueFollowUps,
    followUpsCreated,
    activitiesCompleted,
    wonInRange,
    lostInRange,
    competitorLinked,
    aiSearchesRun,
    aiCandidatesDiscovered,
    trialEligibleCompanies,
    activeCompaniesForActivity,
  ] = await Promise.all([
    prisma.company.count({ where: createdInRangeWhere }),
    prisma.company.count({ where: { AND: [createdInRangeWhere, { source: "MANUAL" }] } }),
    prisma.company.count({ where: { AND: [createdInRangeWhere, { source: "AI_RESEARCH" }] } }),
    prisma.company.count({ where: { AND: [createdInRangeWhere, { source: "IMPORT" }] } }),
    prisma.company.count({ where: activeWhere }),
    prisma.company.count({ where: { AND: [activeWhere, { assignedToId: null }] } }),
    prisma.company.count({
      where: { AND: [companyScopeWhere, { status: "ARCHIVED" }, { archivedAt: { gte: dateRange.start, lt: dateRange.end } }] },
    }),
    prisma.company.groupBy({ by: ["pipelineStageId"], where: activeWhere, _count: true }),
    prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.task.count({
      where: { AND: [reportTaskWhere(scope), { status: "OPEN", dueAt: { lt: now } }, { company: activeWhere }] },
    }),
    prisma.task.count({ where: { AND: [reportTaskWhere(scope), { company: companyScopeWhere }, { createdAt: { gte: dateRange.start, lt: dateRange.end } }] } }),
    prisma.activity.count({ where: { company: companyScopeWhere, occurredAt: { gte: dateRange.start, lt: dateRange.end } } }),
    prisma.pipelineStageHistory.count({
      where: { AND: [{ company: companyScopeWhere }, { changedAt: { gte: dateRange.start, lt: dateRange.end } }, { toStage: { outcomeType: "WON" } }] },
    }),
    prisma.pipelineStageHistory.count({
      where: { AND: [{ company: companyScopeWhere }, { changedAt: { gte: dateRange.start, lt: dateRange.end } }, { toStage: { outcomeType: "LOST" } }] },
    }),
    prisma.company.count({ where: { AND: [activeWhere, { competitorId: { not: null } }] } }),
    prisma.leadSearch.count({ where: { AND: [{ createdBy: reportUserWhere(scope) }, { createdAt: { gte: dateRange.start, lt: dateRange.end } }] } }),
    prisma.searchResult.count({
      where: { search: { AND: [{ createdBy: reportUserWhere(scope) }, { createdAt: { gte: dateRange.start, lt: dateRange.end } }] } },
    }),
    prisma.company.findMany({ where: { AND: [activeWhere, { pipelineStage: { outcomeType: null } }] }, select: { id: true } }),
    prisma.company.findMany({ where: activeWhere, select: { id: true, createdAt: true } }),
  ]);

  const stageNameById = new Map(stages.map((s) => [s.id, s.name]));
  const stageOrderById = new Map(stages.map((s, index) => [s.id, index]));
  const pipelineBreakdown = pipelineGroups
    .map((g) => ({ stageId: g.pipelineStageId, stageName: stageNameById.get(g.pipelineStageId) ?? "Unknown", count: g._count }))
    .sort((a, b) => (stageOrderById.get(a.stageId) ?? 0) - (stageOrderById.get(b.stageId) ?? 0));

  const trialEligibleIds = trialEligibleCompanies.map((c) => c.id);
  const latestActivityForTrials = trialEligibleIds.length
    ? await prisma.activity.findMany({
        where: { companyId: { in: trialEligibleIds } },
        distinct: ["companyId"],
        orderBy: [{ companyId: "asc" }, { occurredAt: "desc" }],
        select: { companyId: true, type: true },
      })
    : [];
  const activeTrials = latestActivityForTrials.filter((a) => a.type === "TRIAL").length;

  const activeIds = activeCompaniesForActivity.map((c) => c.id);
  const latestActivityByCompany = new Map<string, Date>();
  if (activeIds.length > 0) {
    const latest = await prisma.activity.findMany({
      where: { companyId: { in: activeIds } },
      distinct: ["companyId"],
      orderBy: [{ companyId: "asc" }, { occurredAt: "desc" }],
      select: { companyId: true, occurredAt: true },
    });
    for (const a of latest) latestActivityByCompany.set(a.companyId, a.occurredAt);
  }
  const noActivityThreshold = daysAgo(noActivityThresholdDays, now);
  const noRecentActivity = activeCompaniesForActivity.filter(
    (c) => (latestActivityByCompany.get(c.id) ?? c.createdAt) < noActivityThreshold,
  ).length;

  return {
    newLeads,
    manualLeads,
    aiLeads,
    importedLeads,
    activeLeads,
    unassignedLeads,
    archivedInRange,
    pipelineBreakdown,
    overdueFollowUps,
    followUpsCreated,
    activitiesCompleted,
    wonInRange,
    lostInRange,
    competitorLinked,
    aiSearchesRun,
    aiCandidatesDiscovered,
    activeTrials,
    noRecentActivity,
  };
}
