import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { companyScope, taskScope } from "@/lib/companies/scope";
import { getRouteCompanyIds, getRouteSummary } from "@/lib/route-plan/service";
import { getRepScores, repTimeZone, type RepScore } from "@/lib/sales/scoreboard";
import { zonedDayRange } from "@/lib/timezone";
import type { SalesStep, SalesTrack } from "@/generated/prisma/enums";

/** How many companies each My Day step lists before "and N more". */
const LIST_LIMIT = 8;
/** How many Target bars are checked for missing info (the step lists the first few). */
const INFO_SCAN_LIMIT = 200;

export type MyDayCompany = { id: string; name: string; city: string; region: string; salesTrack: SalesTrack; note?: string };
export type MyDayTask = { id: string; title: string; dueAt: Date; overdue: boolean; company: { id: string; name: string } };
export type MyDayAppointment = { id: string; title: string; startAt: Date; timezone: string; company: { id: string; name: string } };

export type MyDayData = {
  timezone: string;
  needInfo: { companies: MyDayCompany[]; total: number };
  readyToVisit: { companies: MyDayCompany[]; total: number } | null;
  routeCount: number | null;
  visitsToday: number;
  introduced: { companies: MyDayCompany[]; total: number };
  tasks: { items: MyDayTask[]; total: number };
  demosToday: MyDayAppointment[];
  trials: { booked: MyDayCompany[]; live: MyDayCompany[] };
  score: RepScore | null;
};

const companySelect = { id: true, name: true, city: true, region: true, salesTrack: true } as const;

/**
 * Everything the My Day page needs for one rep: the bars assigned to them
 * at each step of the sales process, what's missing, today's follow-ups
 * and demos, and their scoreboard. "Today" is the rep's own day
 * (User.timezone). Returns null when the user can't see any leads.
 */
export async function getMyDay(user: AuthenticatedUser & { timezone?: string | null }, now: Date = new Date()): Promise<MyDayData | null> {
  const scope = companyScope(user);
  const tScope = taskScope(user);
  if (!scope || !tScope) return null;

  const timezone = repTimeZone(user.timezone);
  const today = zonedDayRange(now, timezone);
  const mine = { AND: [scope, { status: "ACTIVE" as const, assignedToId: user.id }] };

  const stepStages = await prisma.pipelineStage.findMany({ where: { processStep: { not: null } }, select: { id: true, processStep: true } });
  const stageId = (step: SalesStep) => stepStages.find((stage) => stage.processStep === step)?.id ?? "__none__";
  const atStep = (step: SalesStep) => ({ AND: [mine, { pipelineStageId: stageId(step) }] });

  const canRoute = hasPermission(user, "view_route_plan");

  const [targets, routeIds, routeSummary, visitsToday, introducedTotal, introduced, tasksTotal, tasks, demos, trialsBooked, trialsLive, scores] =
    await Promise.all([
      prisma.company.findMany({
        where: atStep("TARGET"),
        orderBy: { createdAt: "desc" },
        take: INFO_SCAN_LIMIT,
        select: {
          ...companySelect,
          triviaHistory: true,
          contacts: { where: { status: "ACTIVE" }, select: { phone: true, email: true } },
        },
      }),
      canRoute ? getRouteCompanyIds(user.id) : Promise.resolve(new Set<string>()),
      canRoute ? getRouteSummary(user.id) : Promise.resolve(null),
      prisma.activity.count({ where: { userId: user.id, type: "VISIT", occurredAt: { gte: today.start, lt: today.end } } }),
      prisma.company.count({ where: atStep("INTRODUCED") }),
      prisma.company.findMany({ where: atStep("INTRODUCED"), orderBy: { updatedAt: "asc" }, take: LIST_LIMIT, select: companySelect }),
      prisma.task.count({ where: { AND: [tScope, { assignedToId: user.id, status: "OPEN", dueAt: { lt: today.end } }] } }),
      prisma.task.findMany({
        where: { AND: [tScope, { assignedToId: user.id, status: "OPEN", dueAt: { lt: today.end } }] },
        orderBy: { dueAt: "asc" },
        take: LIST_LIMIT,
        select: { id: true, title: true, dueAt: true, company: { select: { id: true, name: true } } },
      }),
      prisma.appointment.findMany({
        where: {
          startAt: { gte: today.start, lt: today.end },
          status: { not: "CANCELLED" },
          OR: [{ createdById: user.id }, { company: { assignedToId: user.id } }],
          company: scope,
        },
        orderBy: { startAt: "asc" },
        select: { id: true, title: true, startAt: true, timezone: true, company: { select: { id: true, name: true } } },
      }),
      prisma.company.findMany({ where: atStep("TRIAL_BOOKED"), orderBy: { updatedAt: "asc" }, select: companySelect }),
      prisma.company.findMany({ where: atStep("TRIAL_LIVE"), orderBy: { updatedAt: "asc" }, select: companySelect }),
      getRepScores([user.id], now),
    ]);

  const needInfoAll = targets.flatMap(({ triviaHistory, contacts, ...company }) => {
    const missing: string[] = [];
    if (!contacts.some((contact) => contact.phone || contact.email)) missing.push("manager contact");
    if (!triviaHistory?.trim()) missing.push("trivia history");
    return missing.length > 0 ? [{ ...company, note: `Missing ${missing.join(" and ")}` }] : [];
  });

  const readyAll = targets.filter((company) => company.salesTrack === "LOCAL" && !routeIds.has(company.id));

  return {
    timezone,
    needInfo: { companies: needInfoAll.slice(0, LIST_LIMIT), total: needInfoAll.length },
    readyToVisit: canRoute
      ? { companies: readyAll.slice(0, LIST_LIMIT).map(({ id, name, city, region, salesTrack }) => ({ id, name, city, region, salesTrack })), total: readyAll.length }
      : null,
    routeCount: routeSummary?.count ?? null,
    visitsToday,
    introduced: { companies: introduced, total: introducedTotal },
    tasks: { items: tasks.map((task) => ({ ...task, overdue: task.dueAt < today.start })), total: tasksTotal },
    demosToday: demos,
    trials: { booked: trialsBooked, live: trialsLive },
    score: scores[0] ?? null,
  };
}
