import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { dayBounds, daysAgo } from "@/lib/dates";
import { UPCOMING_WINDOW_DAYS, computeDailyPriorityList, type PriorityInput, type PriorityItem } from "@/lib/workspace/priority";

export type PriorityThresholds = { noActivityThresholdDays: number; newlyAssignedThresholdDays: number };

/**
 * Personal (assignedToId = this user), not team-scoped — the Salesperson
 * Home Page is explicitly about "what's on my plate today," so this always
 * queries by direct assignment regardless of the viewer's broader
 * companyScope/taskScope visibility.
 */
export async function getMyPriorityList(user: AuthenticatedUser, thresholds: PriorityThresholds): Promise<PriorityItem[]> {
  const { startOfToday, startOfTomorrow } = dayBounds();
  const upcomingEnd = new Date(startOfTomorrow.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [overdueTasks, dueTodayTasks, upcomingTasks, myCompanies] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: user.id, status: "OPEN", dueAt: { lt: startOfToday }, company: { status: "ACTIVE" } },
      include: { company: true },
      orderBy: { dueAt: "asc" },
    }),
    prisma.task.findMany({
      where: { assignedToId: user.id, status: "OPEN", dueAt: { gte: startOfToday, lt: startOfTomorrow }, company: { status: "ACTIVE" } },
      include: { company: true },
      orderBy: { dueAt: "asc" },
    }),
    prisma.task.findMany({
      where: { assignedToId: user.id, status: "OPEN", dueAt: { gte: startOfTomorrow, lt: upcomingEnd }, company: { status: "ACTIVE" } },
      include: { company: true },
      orderBy: { dueAt: "asc" },
    }),
    prisma.company.findMany({
      where: { assignedToId: user.id, status: "ACTIVE" },
      include: {
        pipelineStage: true,
        activities: { orderBy: { occurredAt: "desc" } },
        tasks: { where: { status: "OPEN" } },
      },
    }),
  ]);

  const now = new Date();
  const noActivityThreshold = daysAgo(thresholds.noActivityThresholdDays, now);
  const newlyAssignedThreshold = daysAgo(thresholds.newlyAssignedThresholdDays, now);

  const activeTrials: PriorityInput["activeTrials"] = [];
  const newAssignments: PriorityInput["newAssignments"] = [];
  const staleCompanies: PriorityInput["staleCompanies"] = [];

  for (const company of myCompanies) {
    const lastActivity = company.activities[0];
    const hasOpenTask = company.tasks.length > 0;

    const lastTrialActivity = company.activities.find((a) => a.type === "TRIAL");
    if (company.pipelineStage.outcomeType === null && lastTrialActivity && !hasOpenTask) {
      activeTrials.push({ companyId: company.id, companyName: company.name, lastTrialActivityAt: lastTrialActivity.occurredAt });
    }

    // The most recent ASSIGNMENT_CHANGE activity on a company currently
    // assigned to this user necessarily represents the change that made
    // them the current assignee — if it were reassigned away afterward,
    // another (more recent) ASSIGNMENT_CHANGE row would exist instead.
    const assignmentActivity = company.activities.find((a) => a.type === "ASSIGNMENT_CHANGE");
    if (assignmentActivity && assignmentActivity.occurredAt >= newlyAssignedThreshold) {
      const contactedSince = company.activities.some(
        (a) => a.occurredAt > assignmentActivity.occurredAt && a.type !== "ASSIGNMENT_CHANGE" && a.type !== "PIPELINE_CHANGE",
      );
      if (!contactedSince) {
        newAssignments.push({ companyId: company.id, companyName: company.name, assignedAt: assignmentActivity.occurredAt });
      }
    }

    const referenceAt = lastActivity?.occurredAt ?? company.createdAt;
    if (referenceAt < noActivityThreshold) {
      staleCompanies.push({ companyId: company.id, companyName: company.name, lastActivityAt: referenceAt });
    }
  }

  return computeDailyPriorityList({
    overdueTasks: overdueTasks.map((t) => ({ id: t.id, companyId: t.companyId, companyName: t.company.name, dueAt: t.dueAt })),
    dueTodayTasks: dueTodayTasks.map((t) => ({ id: t.id, companyId: t.companyId, companyName: t.company.name, dueAt: t.dueAt })),
    upcomingTasks: upcomingTasks.map((t) => ({ id: t.id, companyId: t.companyId, companyName: t.company.name, dueAt: t.dueAt })),
    activeTrials,
    newAssignments,
    staleCompanies,
  });
}

export async function getMyPipelineCounts(user: AuthenticatedUser) {
  const companies = await prisma.company.findMany({
    where: { assignedToId: user.id, status: "ACTIVE" },
    include: { pipelineStage: true },
  });

  const counts = new Map<string, number>();
  for (const company of companies) {
    counts.set(company.pipelineStage.name, (counts.get(company.pipelineStage.name) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([stageName, count]) => ({ stageName, count }));
}
