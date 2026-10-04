import "server-only";
import { prisma } from "@/lib/prisma";
import { BUSINESS_TIMEZONE, zonedDayRange, zonedWeekRange, type DateRange } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/comms/calendar-time";
import type { SalesStep } from "@/generated/prisma/enums";
import { DEFAULT_TARGETS, type ScoreboardMetric, type ScoreCounts } from "./scoreboard-metrics";

export { SCOREBOARD_METRICS, SCOREBOARD_LABELS, DEFAULT_TARGETS, type ScoreboardMetric, type ScoreCounts } from "./scoreboard-metrics";

/**
 * The sales scoreboard: what each rep did today (and this week) against
 * their daily goals. Counts, all by the rep's own calendar day
 * (User.timezone, else BUSINESS_TIMEZONE):
 * - visits: VISIT activities the rep logged (flyer drop-offs, walk-ins)
 * - intros: long-distance bars the rep moved into the Introduced step
 * - demosBooked / demosHeld / trialsBooked: bars the rep moved into that
 *   step, however they moved it (card, board, edit form, call or visit
 *   outcome). A bar counts once per step per period even if it bounced.
 * Steps are found by PipelineStage.processStep, never by stage name.
 */
const STEP_METRICS: { metric: Exclude<ScoreboardMetric, "visits">; step: SalesStep; remoteOnly: boolean }[] = [
  { metric: "intros", step: "INTRODUCED", remoteOnly: true },
  { metric: "demosBooked", step: "DEMO_BOOKED", remoteOnly: false },
  { metric: "demosHeld", step: "DEMO_HELD", remoteOnly: false },
  { metric: "trialsBooked", step: "TRIAL_BOOKED", remoteOnly: false },
];

export function repTimeZone(timezone: string | null | undefined): string {
  return timezone && isValidTimeZone(timezone) ? timezone : BUSINESS_TIMEZONE;
}

async function countFor(userId: string, range: DateRange, stepStageIds: Map<SalesStep, string>): Promise<ScoreCounts> {
  const window = { gte: range.start, lt: range.end };
  const visits = prisma.activity.count({ where: { userId, type: "VISIT", occurredAt: window } });
  const steps = STEP_METRICS.map(async ({ metric, step, remoteOnly }) => {
    const stageId = stepStageIds.get(step);
    if (!stageId) return [metric, 0] as const;
    const rows = await prisma.pipelineStageHistory.findMany({
      where: {
        changedById: userId,
        toStageId: stageId,
        changedAt: window,
        ...(remoteOnly ? { company: { salesTrack: "REMOTE" as const } } : {}),
      },
      select: { companyId: true },
      distinct: ["companyId"],
    });
    return [metric, rows.length] as const;
  });
  const [visitCount, stepCounts] = await Promise.all([visits, Promise.all(steps)]);
  return { visits: visitCount, ...Object.fromEntries(stepCounts) } as ScoreCounts;
}

export type RepScore = {
  userId: string;
  name: string;
  timezone: string;
  targets: ScoreCounts;
  today: ScoreCounts;
  week: ScoreCounts;
};

/** Scores for the given reps (today + Monday-start week, each in the rep's
 * own timezone). */
export async function getRepScores(userIds: string[], now: Date = new Date()): Promise<RepScore[]> {
  if (userIds.length === 0) return [];
  const [users, stepStages] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, timezone: true, salesTarget: true },
      orderBy: { name: "asc" },
    }),
    prisma.pipelineStage.findMany({ where: { processStep: { not: null } }, select: { id: true, processStep: true } }),
  ]);
  const stepStageIds = new Map(stepStages.flatMap((stage) => (stage.processStep ? [[stage.processStep, stage.id] as const] : [])));

  return Promise.all(
    users.map(async (user) => {
      const timezone = repTimeZone(user.timezone);
      const [today, week] = await Promise.all([
        countFor(user.id, zonedDayRange(now, timezone), stepStageIds),
        countFor(user.id, zonedWeekRange(now, timezone), stepStageIds),
      ]);
      const target = user.salesTarget;
      return {
        userId: user.id,
        name: user.name,
        timezone,
        targets: target
          ? { visits: target.visits, intros: target.intros, demosBooked: target.demosBooked, demosHeld: target.demosHeld, trialsBooked: target.trialsBooked }
          : DEFAULT_TARGETS,
        today,
        week,
      };
    }),
  );
}

/** Active users whose role can work leads (edit_leads) — the people the
 * Manager scoreboard lists. */
export async function listSalesReps(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { disabled: false, role: { permissions: { some: { allowed: true, permission: { key: "edit_leads" } } } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
