import "server-only";
import type { Prisma } from "../../generated/prisma/client";

/**
 * Logs the completed-call Activity inside the caller's transaction —
 * mirrors src/lib/companies/activity-log.ts's exact tx-scoped-helper idiom
 * (logPipelineChange/logAssignmentChange). Unlike those, this is the one
 * path that actually populates Activity.outcome (previously only the
 * free-form manual "Log an activity" form did) — a recorded call genuinely
 * has an outcome the way a manual note usually doesn't.
 */
export async function logCallActivity(
  tx: Prisma.TransactionClient,
  params: { companyId: string; userId: string; outcomeName: string; notes: string | null },
) {
  return tx.activity.create({
    data: { companyId: params.companyId, userId: params.userId, type: "PHONE", outcome: params.outcomeName, notes: params.notes },
  });
}
