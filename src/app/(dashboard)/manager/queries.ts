import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { companyScope, taskScope } from "@/lib/companies/scope";
import { getDashboardStats } from "@/app/(dashboard)/dashboard/queries";
import { dayBounds } from "@/lib/dates";
import { territoryWhereClause } from "@/lib/workspace/territory-match";

export async function getManagerWorkspaceData(user: AuthenticatedUser) {
  const scope = companyScope(user);
  const tScope = taskScope(user);
  if (!scope || !tScope) return null;

  const stats = await getDashboardStats(user);
  if (!stats) return null;

  const { startOfToday } = dayBounds();

  const [unassignedCount, overdueBySalespersonRaw, activeTrialsCount, recentlyResolved, territories] = await Promise.all([
    prisma.company.count({ where: { AND: [scope, { status: "ACTIVE", assignedToId: null }] } }),
    prisma.task.groupBy({
      by: ["assignedToId"],
      where: { AND: [tScope, { status: "OPEN", dueAt: { lt: startOfToday } }] },
      _count: true,
    }),
    prisma.company.count({
      where: {
        AND: [
          scope,
          { status: "ACTIVE" },
          { pipelineStage: { outcomeType: null } },
          { activities: { some: { type: "TRIAL" } } },
        ],
      },
    }),
    prisma.company.findMany({
      where: { AND: [scope, { status: "ACTIVE" }, { pipelineStage: { outcomeType: { not: null } } }] },
      include: { pipelineStage: true, assignedTo: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.territory.findMany({ where: { active: true }, include: { assignedTo: true } }),
  ]);

  const users = await prisma.user.findMany({ where: { disabled: false } });
  const userNameById = new Map(users.map((u) => [u.id, u.name]));
  const overdueBySalesperson = overdueBySalespersonRaw.map((g) => ({
    userId: g.assignedToId,
    userName: userNameById.get(g.assignedToId) ?? "Unknown",
    count: g._count,
  }));

  const territoryCoverage = await Promise.all(
    territories.map(async (territory) => {
      const count = await prisma.company.count({
        where: { AND: [scope, { status: "ACTIVE" }, territoryWhereClause(territory)] },
      });
      return {
        id: territory.id,
        name: territory.name ?? [territory.city, territory.region, territory.country].filter(Boolean).join(", "),
        assignedToName: territory.assignedTo?.name ?? null,
        companyCount: count,
      };
    }),
  );

  return {
    stats,
    unassignedCount,
    overdueBySalesperson,
    activeTrialsCount,
    recentlyResolved: recentlyResolved.map((c) => ({
      id: c.id,
      name: c.name,
      stageName: c.pipelineStage.name,
      outcomeType: c.pipelineStage.outcomeType,
      assignedToName: c.assignedTo?.name ?? "Unassigned",
      updatedAt: c.updatedAt,
    })),
    territoryCoverage,
  };
}
