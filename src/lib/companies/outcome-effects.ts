import "server-only";
import type { AppTransactionClient } from "../prisma";
import { logPipelineChange } from "./activity-log";
import { isForwardMove } from "./sales-process";

type OutcomeConfig = {
  name: string;
  requiresNextAction: boolean;
  defaultNextActionDays: number | null;
  defaultNextActionTitle: string | null;
  defaultPipelineStageId: string | null;
  appliesDoNotContact: boolean;
};

/**
 * Applies a CallOutcome's configured side effects inside the caller's
 * transaction — the pipeline-stage move, the default follow-up task, and
 * the do-not-contact flag. Shared by a calling-session call
 * (recordCallOutcome) and an in-person visit (logVisit) so the same
 * admin-configured outcome behaves identically whichever channel recorded
 * it. `canChangeStage` is the caller's permission decision; a stage move is
 * skipped (not an error) without it, matching recordCallOutcome's original
 * behavior.
 *
 * Sales process rules: an outcome only ever moves a company forward (see
 * isForwardMove), and when the move creates the new stage's automatic
 * follow-ups, those replace the outcome's own default follow-up rather than
 * doubling up with it. Returns the created task's id, if any, and the
 * stage actually applied.
 */
export async function applyOutcomeEffects(
  tx: AppTransactionClient,
  params: {
    company: { id: string; assignedToId: string | null; pipelineStageId: string };
    userId: string;
    outcome: OutcomeConfig;
    canChangeStage: boolean;
    rejectionReasonId?: string | null;
    /** The activity this outcome was logged as; its follow-up links to it
     * so the activity timeline shows the follow-up on that entry. */
    activityId?: string | null;
    now?: Date;
  },
): Promise<{ taskId: string | null; appliedPipelineStageId: string | null }> {
  const { company, userId, outcome } = params;
  const now = params.now ?? new Date();

  let appliedPipelineStageId: string | null = null;
  let entryTaskCount = 0;
  const targetStageId = params.canChangeStage ? outcome.defaultPipelineStageId : null;
  if (targetStageId && targetStageId !== company.pipelineStageId) {
    const [fromStage, toStage] = await Promise.all([
      tx.pipelineStage.findUnique({ where: { id: company.pipelineStageId } }),
      tx.pipelineStage.findUnique({ where: { id: targetStageId } }),
    ]);
    if (fromStage && toStage && toStage.active && isForwardMove(fromStage, toStage)) {
      await tx.company.update({ where: { id: company.id }, data: { pipelineStageId: targetStageId } });
      ({ entryTaskCount } = await logPipelineChange(tx, {
        companyId: company.id,
        userId,
        fromStageId: company.pipelineStageId,
        toStageId: targetStageId,
        lossReasonId: params.rejectionReasonId ?? null,
      }));
      appliedPipelineStageId = targetStageId;
    }
  }

  let taskId: string | null = null;
  if (outcome.requiresNextAction && outcome.defaultNextActionDays !== null && entryTaskCount === 0) {
    const dueAt = new Date(now.getTime() + outcome.defaultNextActionDays * 24 * 60 * 60 * 1000);
    const task = await tx.task.create({
      data: {
        companyId: company.id,
        assignedToId: company.assignedToId ?? userId,
        title: outcome.defaultNextActionTitle ?? outcome.name,
        dueAt,
        activityId: params.activityId ?? null,
      },
    });
    taskId = task.id;
  }

  if (outcome.appliesDoNotContact) {
    await tx.company.update({ where: { id: company.id }, data: { doNotContact: true } });
  }

  return { taskId, appliedPipelineStageId };
}
