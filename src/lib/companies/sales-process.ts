import "server-only";
import type { Prisma } from "../../generated/prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Creates the target stage's automatic follow-ups (PipelineStageTask) for a
 * company that just entered it, inside the caller's transaction. Called
 * from logPipelineChange, so it fires however the company got there —
 * pipeline board, edit form, bulk change, or a call/visit outcome. Only the
 * tasks for the company's track (or for both tracks) are created, assigned
 * to the company's salesperson, or to whoever moved it when unassigned.
 * Returns how many were created.
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

  const tasks = await tx.pipelineStageTask.findMany({
    where: { stageId: params.toStageId, OR: [{ track: null }, { track: company.salesTrack }] },
    orderBy: [{ daysAfter: "asc" }, { sortOrder: "asc" }],
  });
  if (tasks.length === 0) return 0;

  const now = params.now ?? new Date();
  await tx.task.createMany({
    data: tasks.map((task) => ({
      companyId: params.companyId,
      assignedToId: company.assignedToId ?? params.userId,
      title: task.title,
      dueAt: new Date(now.getTime() + task.daysAfter * DAY_MS),
    })),
  });
  return tasks.length;
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
