import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope, reportUserWhere } from "@/lib/reports/scope";
import { resolveReportFilters, type ReportFilters } from "@/lib/reports/filters";

/**
 * Deliberately four separate counts per salesperson, never one blended
 * score — the brief explicitly warns against "simplistic rankings that
 * reward meaningless activity volume." A high activity count with zero
 * pipeline progress is a signal worth seeing, not something a combined
 * ranking would average away.
 */
export async function getSalespeopleReport(user: AuthenticatedUser, filters: ReportFilters) {
  const scope = reportScope(user);
  if (!scope) return null;

  const { dateRange, companyWhere } = await resolveReportFilters(filters, scope);

  const salespeople = await prisma.user.findMany({
    where: { AND: [reportUserWhere(scope), { disabled: false }, filters.assignedToId ? { id: filters.assignedToId } : {}] },
    orderBy: { name: "asc" },
  });
  const ids = salespeople.map((u) => u.id);
  if (ids.length === 0) return { rows: [] };

  const rangeWhere = { gte: dateRange.start, lt: dateRange.end };
  const workloadStatus = (filters.status ?? "ACTIVE") as "ACTIVE" | "ARCHIVED";

  const [activityGroups, stageProgressRows, wonGroups, lostGroups, workloadGroups] = await Promise.all([
    prisma.activity.findMany({
      where: { userId: { in: ids }, occurredAt: rangeWhere, company: companyWhere },
      select: { userId: true },
    }),
    // "Pipeline progress" is movement on a salesperson's own book of
    // business (company.assignedToId), not a tally of who clicked the
    // button (changedById) — a Manager moving a rep's lead on their behalf
    // still counts as progress for that rep, and doesn't inflate the
    // Manager's own numbers. Grouping directly on a relation field isn't
    // supported by Prisma's groupBy, so this pulls the assignee per row and
    // tallies in JS instead of N per-salesperson queries.
    prisma.pipelineStageHistory.findMany({
      where: { changedAt: rangeWhere, company: { AND: [companyWhere, { assignedToId: { in: ids } }] } },
      select: { company: { select: { assignedToId: true } } },
    }),
    prisma.pipelineStageHistory.groupBy({
      by: ["companyId"],
      where: { changedAt: rangeWhere, toStage: { outcomeType: "WON" }, company: { AND: [companyWhere, { assignedToId: { in: ids } }] } },
      _count: true,
    }),
    prisma.pipelineStageHistory.groupBy({
      by: ["companyId"],
      where: { changedAt: rangeWhere, toStage: { outcomeType: "LOST" }, company: { AND: [companyWhere, { assignedToId: { in: ids } }] } },
      _count: true,
    }),
    prisma.company.groupBy({
      by: ["assignedToId"],
      where: { AND: [companyWhere, { assignedToId: { in: ids }, status: workloadStatus }] },
      _count: true,
    }),
  ]);

  // Won/Lost are grouped by companyId (their assignee isn't a groupable
  // scalar on PipelineStageHistory), so a second lightweight lookup maps
  // each decided company back to its assignee for the per-salesperson tally.
  const decidedCompanyIds = [...wonGroups.map((g) => g.companyId), ...lostGroups.map((g) => g.companyId)];
  const decidedCompanies = decidedCompanyIds.length
    ? await prisma.company.findMany({ where: { id: { in: decidedCompanyIds } }, select: { id: true, assignedToId: true } })
    : [];
  const assigneeByCompanyId = new Map(decidedCompanies.map((c) => [c.id, c.assignedToId]));

  const activityById = new Map<string, number>();
  for (const row of activityGroups) activityById.set(row.userId, (activityById.get(row.userId) ?? 0) + 1);
  const progressById = new Map<string, number>();
  for (const row of stageProgressRows) {
    const assigneeId = row.company.assignedToId;
    if (assigneeId) progressById.set(assigneeId, (progressById.get(assigneeId) ?? 0) + 1);
  }
  const workloadById = new Map(workloadGroups.filter((g) => g.assignedToId !== null).map((g) => [g.assignedToId as string, g._count]));

  const wonById = new Map<string, number>();
  for (const g of wonGroups) {
    const assigneeId = assigneeByCompanyId.get(g.companyId);
    if (assigneeId) wonById.set(assigneeId, (wonById.get(assigneeId) ?? 0) + g._count);
  }
  const lostById = new Map<string, number>();
  for (const g of lostGroups) {
    const assigneeId = assigneeByCompanyId.get(g.companyId);
    if (assigneeId) lostById.set(assigneeId, (lostById.get(assigneeId) ?? 0) + g._count);
  }

  const rows = salespeople.map((sp) => ({
    userId: sp.id,
    name: sp.name,
    activitiesCompleted: activityById.get(sp.id) ?? 0,
    pipelineProgress: progressById.get(sp.id) ?? 0,
    won: wonById.get(sp.id) ?? 0,
    lost: lostById.get(sp.id) ?? 0,
    currentWorkload: workloadById.get(sp.id) ?? 0,
  }));

  return { rows };
}
