import "server-only";
import type { Prisma } from "../../generated/prisma/client";
import { logPipelineChange } from "./activity-log";

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
 * transaction — the default follow-up task, the pipeline-stage move, and
 * the do-not-contact flag. Shared by a calling-session call
 * (recordCallOutcome) and an in-person visit (logVisit) so the same
 * admin-configured outcome behaves identically whichever channel recorded
 * it. `canChangeStage` is the caller's permission decision; a stage move is
 * skipped (not an error) without it, matching recordCallOutcome's original
 * behavior. Returns the created task's id, if any.
 */
export async function applyOutcomeEffects(
  tx: Prisma.TransactionClient,
  params: {
    company: { id: string; assignedToId: string | null; pipelineStageId: string };
    userId: string;
    outcome: OutcomeConfig;
    canChangeStage: boolean;
    rejectionReasonId?: string | null;
    now?: Date;
  },
): Promise<{ taskId: string | null; appliedPipelineStageId: string | null }> {
  const { company, userId, outcome } = params;
  const now = params.now ?? new Date();

  let taskId: string | null = null;
  if (outcome.requiresNextAction && outcome.defaultNextActionDays !== null) {
    const dueAt = new Date(now.getTime() + outcome.defaultNextActionDays * 24 * 60 * 60 * 1000);
    const task = await tx.task.create({
      data: {
        companyId: company.id,
        assignedToId: company.assignedToId ?? userId,
        title: outcome.defaultNextActionTitle ?? outcome.name,
        dueAt,
      },
    });
    taskId = task.id;
  }

  const stageId = params.canChangeStage ? outcome.defaultPipelineStageId : null;
  if (stageId && stageId !== company.pipelineStageId) {
    await logPipelineChange(tx, {
      companyId: company.id,
      userId,
      fromStageId: company.pipelineStageId,
      toStageId: stageId,
      lossReasonId: params.rejectionReasonId ?? null,
    });
    await tx.company.update({ where: { id: company.id }, data: { pipelineStageId: stageId } });
  }

  if (outcome.appliesDoNotContact) {
    await tx.company.update({ where: { id: company.id }, data: { doNotContact: true } });
  }

  return { taskId, appliedPipelineStageId: stageId };
}
