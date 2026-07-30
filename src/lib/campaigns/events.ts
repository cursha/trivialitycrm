// No `import "server-only"` — recordCampaignEvent is called from both
// server actions (campaigns/actions.ts) and worker code (run-step.ts,
// send-campaign-tick.ts), same reasoning as every other worker-reachable
// module in this tree.
import type { Prisma } from "@/generated/prisma/client";
import type { CampaignEventType } from "@/generated/prisma/enums";

/**
 * Appends one row to a campaign's timeline — never updated once written.
 * Accepts either the plain client or a transaction client so a caller
 * already inside a $transaction (e.g. approveCampaign, cancelCampaign) can
 * log the event atomically with the state change it describes, matching
 * every other tx-scoped-helper in this codebase (logCallActivity,
 * logPipelineChange).
 */
export async function recordCampaignEvent(
  db: Prisma.TransactionClient | { campaignEvent: Prisma.TransactionClient["campaignEvent"] },
  params: {
    campaignId: string;
    recipientId?: string;
    stepId?: string;
    type: CampaignEventType;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.campaignEvent.create({
    data: {
      campaignId: params.campaignId,
      recipientId: params.recipientId ?? null,
      stepId: params.stepId ?? null,
      type: params.type,
      metadata: params.metadata ?? undefined,
    },
  });
}
