import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { companyScope, taskScope } from "@/lib/companies/scope";

export async function getDashboardStats(user: AuthenticatedUser) {
  const scope = companyScope(user);
  const tScope = taskScope(user);

  if (!scope || !tScope) {
    return null;
  }

  const activeWhere = { AND: [scope, { status: "ACTIVE" as const }] };

  const [
    activeLeads,
    pipelineGroups,
    leadTypeGroups,
    salespeopleGroups,
    competitorGroups,
    gradeGroups,
    classificationGroups,
    stages,
    leadTypes,
    users,
    competitors,
  ] = await Promise.all([
    prisma.company.count({ where: activeWhere }),
    prisma.company.groupBy({ by: ["pipelineStageId"], where: activeWhere, _count: true }),
    prisma.company.groupBy({ by: ["leadTypeId"], where: activeWhere, _count: true }),
    prisma.company.groupBy({ by: ["assignedToId"], where: activeWhere, _count: true }),
    prisma.company.groupBy({ by: ["competitorId"], where: activeWhere, _count: true }),
    prisma.company.groupBy({ by: ["opportunityGrade"], where: activeWhere, _count: true }),
    prisma.company.groupBy({ by: ["primaryClassification"], where: activeWhere, _count: true }),
    prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.leadType.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany(),
    prisma.competitor.findMany(),
  ]);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const [followUpsDueToday, followUpsOverdue] = await Promise.all([
    prisma.task.count({
      where: { AND: [tScope, { status: "OPEN", dueAt: { gte: startOfToday, lt: startOfTomorrow } }] },
    }),
    prisma.task.count({ where: { AND: [tScope, { status: "OPEN", dueAt: { lt: startOfToday } }] } }),
  ]);

  const stageNameById = new Map(stages.map((s) => [s.id, s.name]));
  const leadTypeNameById = new Map(leadTypes.map((t) => [t.id, t.name]));
  const userNameById = new Map(users.map((u) => [u.id, u.name]));
  const competitorNameById = new Map(competitors.map((c) => [c.id, c.name]));
  const stageOrderById = new Map(stages.map((s, index) => [s.id, index]));

  function countForStageName(name: string): number {
    const stage = stages.find((s) => s.name === name);
    if (!stage) return 0;
    return pipelineGroups.find((g) => g.pipelineStageId === stage.id)?._count ?? 0;
  }

  return {
    activeLeads,
    pipelineBreakdown: pipelineGroups
      .map((g) => ({
        stageId: g.pipelineStageId,
        stageName: stageNameById.get(g.pipelineStageId) ?? "Unknown",
        count: g._count,
      }))
      .sort((a, b) => (stageOrderById.get(a.stageId) ?? 0) - (stageOrderById.get(b.stageId) ?? 0)),
    followUpsDueToday,
    followUpsOverdue,
    demos: countForStageName("Demo Given"),
    trials: countForStageName("Trial"),
    booked: countForStageName("Booked"),
    won: countForStageName("Won"),
    leadTypeBreakdown: leadTypeGroups.map((g) => ({
      leadTypeId: g.leadTypeId,
      leadTypeName: leadTypeNameById.get(g.leadTypeId) ?? "Unknown",
      count: g._count,
    })),
    salespeopleBreakdown: salespeopleGroups.map((g) => ({
      userId: g.assignedToId,
      userName: userNameById.get(g.assignedToId) ?? "Unknown",
      count: g._count,
    })),
    competitorsBreakdown: competitorGroups
      .filter((g): g is typeof g & { competitorId: string } => g.competitorId !== null)
      .map((g) => ({
        competitorId: g.competitorId,
        competitorName: competitorNameById.get(g.competitorId) ?? "Unknown",
        count: g._count,
      })),
    eosGradeBreakdown: gradeGroups
      .filter((g): g is typeof g & { opportunityGrade: string } => g.opportunityGrade !== null)
      .map((g) => ({ grade: g.opportunityGrade, count: g._count })),
    classificationBreakdown: classificationGroups
      .filter((g): g is typeof g & { primaryClassification: string } => g.primaryClassification !== null)
      .map((g) => ({ classification: g.primaryClassification, count: g._count })),
  };
}
