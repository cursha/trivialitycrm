import "server-only";
import type { Prisma } from "../../generated/prisma/client";

/**
 * Logs a PIPELINE_CHANGE activity inside the caller's transaction — shared
 * by the full company-edit form (updateCompany), the pipeline board's
 * lightweight stage-change action, and bulk stage changes, so every path
 * produces an identical audit trail. Also writes the structured
 * PipelineStageHistory row Module Five's reporting reads from — the
 * Activity row stays the human-readable free-text log; this is its
 * purpose-built reporting twin (stage identity by id, not by
 * admin-renameable name). `lossReasonId` is only ever persisted when the
 * target stage's outcome is actually LOST — passing one for a non-Lost
 * move is silently dropped rather than trusted, so a stale value left over
 * from a prior form state can never be recorded against the wrong stage.
 */
export async function logPipelineChange(
  tx: Prisma.TransactionClient,
  params: { companyId: string; userId: string; fromStageId: string; toStageId: string; lossReasonId?: string | null },
): Promise<void> {
  const [fromStage, toStage] = await Promise.all([
    tx.pipelineStage.findUnique({ where: { id: params.fromStageId } }),
    tx.pipelineStage.findUnique({ where: { id: params.toStageId } }),
  ]);

  await tx.activity.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      type: "PIPELINE_CHANGE",
      notes: `Pipeline stage changed from "${fromStage?.name ?? "Unknown"}" to "${toStage?.name ?? "Unknown"}".`,
    },
  });

  await tx.pipelineStageHistory.create({
    data: {
      companyId: params.companyId,
      fromStageId: params.fromStageId,
      toStageId: params.toStageId,
      changedById: params.userId,
      lossReasonId: toStage?.outcomeType === "LOST" ? (params.lossReasonId ?? null) : null,
    },
  });
}

/**
 * Writes the first PipelineStageHistory row for a newly created company
 * (fromStageId: null) — without this, "time in stage" for a brand-new
 * company would have no starting point to measure from. Deliberately does
 * not also write an Activity row: creation already has its own audit trail
 * (Company.createdById/createdAt), and "moved into New" isn't a change
 * worth narrating the way an actual stage transition is.
 */
export async function logInitialPipelineStage(
  tx: Prisma.TransactionClient,
  params: { companyId: string; userId: string; toStageId: string },
): Promise<void> {
  await tx.pipelineStageHistory.create({
    data: {
      companyId: params.companyId,
      fromStageId: null,
      toStageId: params.toStageId,
      changedById: params.userId,
    },
  });
}

/**
 * Logs an ASSIGNMENT_CHANGE activity inside the caller's transaction —
 * shared by single reassignment (updateCompany), the pipeline board's
 * lightweight assign action, and bulk reassignment, so all three produce
 * an identical audit trail instead of three separate inline copies. Mirrors
 * the existing inline PIPELINE_CHANGE pattern in companies/actions.ts.
 */
export async function logAssignmentChange(
  tx: Prisma.TransactionClient,
  params: { companyId: string; userId: string; fromUserId: string | null; toUserId: string | null },
): Promise<void> {
  const [fromUser, toUser] = await Promise.all([
    params.fromUserId ? tx.user.findUnique({ where: { id: params.fromUserId } }) : null,
    params.toUserId ? tx.user.findUnique({ where: { id: params.toUserId } }) : null,
  ]);

  await tx.activity.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      type: "ASSIGNMENT_CHANGE",
      notes: `Assigned salesperson changed from "${fromUser?.name ?? "Unassigned"}" to "${toUser?.name ?? "Unassigned"}".`,
    },
  });
}
