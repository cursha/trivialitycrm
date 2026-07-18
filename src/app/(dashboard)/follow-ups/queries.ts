import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { taskScope, companyScope } from "@/lib/companies/scope";

function dayBounds() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  return { startOfToday, startOfTomorrow };
}

export async function listOverdueTasks(user: AuthenticatedUser) {
  const scope = taskScope(user);
  if (!scope) return [];
  const { startOfToday } = dayBounds();

  return prisma.task.findMany({
    where: { AND: [scope, { status: "OPEN", dueAt: { lt: startOfToday } }] },
    include: { company: true, assignedTo: true },
    orderBy: { dueAt: "asc" },
  });
}

export async function listDueTodayTasks(user: AuthenticatedUser) {
  const scope = taskScope(user);
  if (!scope) return [];
  const { startOfToday, startOfTomorrow } = dayBounds();

  return prisma.task.findMany({
    where: { AND: [scope, { status: "OPEN", dueAt: { gte: startOfToday, lt: startOfTomorrow } }] },
    include: { company: true, assignedTo: true },
    orderBy: { dueAt: "asc" },
  });
}

export async function listUpcomingTasks(user: AuthenticatedUser) {
  const scope = taskScope(user);
  if (!scope) return [];
  const { startOfTomorrow } = dayBounds();

  return prisma.task.findMany({
    where: { AND: [scope, { status: "OPEN", dueAt: { gte: startOfTomorrow } }] },
    include: { company: true, assignedTo: true },
    orderBy: { dueAt: "asc" },
  });
}

export async function listCompletedTasks(user: AuthenticatedUser) {
  const scope = taskScope(user);
  if (!scope) return [];

  return prisma.task.findMany({
    where: { AND: [scope, { status: "COMPLETED" }] },
    include: { company: true, assignedTo: true },
    orderBy: { completedAt: "desc" },
    take: 100,
  });
}

export async function listCompaniesWithoutFollowUp(user: AuthenticatedUser) {
  const scope = companyScope(user);
  if (!scope) return [];

  return prisma.company.findMany({
    where: { AND: [scope, { status: "ACTIVE" }, { tasks: { none: { status: "OPEN" } } }] },
    include: { assignedTo: true },
    orderBy: { name: "asc" },
  });
}
