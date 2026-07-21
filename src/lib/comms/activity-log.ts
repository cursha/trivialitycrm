// No `import "server-only"` — Phase C's scheduled-send/sequence-step worker
// handlers need this too; same reasoning as token-crypto.ts and every other
// Module Six file the worker will eventually import.
import type { Prisma } from "../../generated/prisma/client";

/**
 * Logs the existing free-text EMAIL activity type for a send performed
 * through EmailMessage — keeps the company timeline's audit trail in sync
 * with the new structured table, mirroring the exact split Module Five
 * already established between PipelineStageHistory and the PIPELINE_CHANGE
 * activity (src/lib/companies/activity-log.ts).
 */
export async function logEmailSent(
  tx: Prisma.TransactionClient,
  params: { companyId: string; userId: string; subject: string; toAddresses: string[] },
): Promise<void> {
  await tx.activity.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      type: "EMAIL",
      notes: `Sent "${params.subject}" to ${params.toAddresses.join(", ")}.`,
    },
  });
}
