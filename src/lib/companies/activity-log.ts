import "server-only";
import type { Prisma } from "../../generated/prisma/client";

/**
 * Logs a PIPELINE_CHANGE activity inside the caller's transaction — shared
 * by the full company-edit form (updateCompany), the pipeline board's
 * lightweight stage-change action, and bulk stage changes, so every path
 * produces an identical audit trail.
 */
export async function logPipelineChange(
  tx: Prisma.TransactionClient,
  params: { companyId: string; userId: string; fromStageId: string; toStageId: string },
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
