import "server-only";
import type { Prisma } from "../../generated/prisma/client";
import { fillTrialWeeks, trialWeeksFor } from "./sales-track";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Creates the target stage's automatic follow-ups (PipelineStageTask) for a
 * company that just entered it, inside the caller's transaction. Called
 * from logPipelineChange, so it fires however the company got there —
 * pipeline board, edit form, bulk change, or a call/visit outcome. Only the
 * tasks for the company's track (or for both tracks) are created, assigned
 * to the company's salesperson, or to whoever moved it when unassigned.
 *
 * Trial timing follows that same rep's trial length (User.trialLengthWeeks):
 * a `fromTrialEnd` follow-up is due that many days before the trial ends,
 * and on the Trial Live step a regular follow-up that would fall on or
 * after the end of the trial is skipped (e.g. no week-3 ask in a 2-week
 * trial). {{trialWeeks}} in a title is filled in. Returns how many were
 * created.
 */
export async function createStageEntryTasks(
  tx: Prisma.TransactionClient,
  params: { companyId: string; toStageId: string; userId: string; now?: Date },
): Promise<number> {
  const company = await tx.company.findUnique({
    where: { id: params.companyId },
    select: { assignedToId: true, salesTrack: true },
  });
  if (!company) return 0;

  const [stage, tasks] = await Promise.all([
    tx.pipelineStage.findUnique({ where: { id: params.toStageId }, select: { processStep: true } }),
    tx.pipelineStageTask.findMany({
      where: { stageId: params.toStageId, OR: [{ track: null }, { track: company.salesTrack }] },
      orderBy: [{ daysAfter: "asc" }, { sortOrder: "asc" }],
    }),
  ]);
  if (tasks.length === 0) return 0;

  const assigneeId = company.assignedToId ?? params.userId;
  const rep = await tx.user.findUnique({ where: { id: assigneeId }, select: { trialLengthWeeks: true } });
  const trialWeeks = trialWeeksFor(rep);
  const trialDays = trialWeeks * 7;
  const isTrialLive = stage?.processStep === "TRIAL_LIVE";

  const now = params.now ?? new Date();
  const data = tasks.flatMap((task) => {
    if (!task.fromTrialEnd && isTrialLive && task.daysAfter > 0 && task.daysAfter >= trialDays) return [];
    const days = task.fromTrialEnd ? Math.max(0, trialDays - task.daysAfter) : task.daysAfter;
    return [
      {
        companyId: params.companyId,
        assignedToId: assigneeId,
        title: fillTrialWeeks(task.title, trialWeeks),
        dueAt: new Date(now.getTime() + days * DAY_MS),
      },
    ];
  });
  if (data.length === 0) return 0;
  await tx.task.createMany({ data });
  return data.length;
}

type StageOrder = { sortOrder: number; outcomeType: string | null };

/**
 * Whether an automatic (outcome-driven) stage move should happen: only
 * forward in the process, so logging a flyer drop at a bar that's already
 * mid-trial never drags it back to Introduced. Won and Lost are always
 * allowed from an open stage. A company already Won or Lost is never moved
 * automatically; a person moves it back deliberately if it re-engages.
 */
export function isForwardMove(from: StageOrder, to: StageOrder): boolean {
  if (from.outcomeType !== null) return false;
  if (to.outcomeType !== null) return true;
  return to.sortOrder > from.sortOrder;
}
