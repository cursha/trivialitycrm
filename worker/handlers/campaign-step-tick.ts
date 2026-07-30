import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { enqueueRunCampaignStepJob } from "../../src/lib/jobs/enqueue";

/**
 * Runs every 5 minutes (see worker/main.ts) — the campaign-side
 * counterpart to sequence-tick.ts. Finds every ACTIVE CampaignRecipient
 * (across every campaign) whose nextStepDueAt has passed and enqueues one
 * durable run-campaign-step job per row for its currentStepId. Does NOT
 * advance the recipient itself — that only happens once the step actually
 * runs (see processDueCampaignStep) — so a row stays "due" and gets
 * re-offered every tick until it's actually processed. Duplicate enqueues
 * across ticks are harmless: pg-boss's singleton policy (keyed on
 * recipientId:stepId) silently no-ops a repeat, and
 * CampaignRecipientStepRun's own unique constraint is the final backstop.
 */
export async function runCampaignStepTick(): Promise<number> {
  const due = await prisma.campaignRecipient.findMany({
    where: { status: "ACTIVE", nextStepDueAt: { lte: new Date() }, currentStepId: { not: null } },
    select: { id: true, currentStepId: true },
  });

  let enqueued = 0;
  for (const recipient of due) {
    const jobId = await enqueueRunCampaignStepJob(recipient.id, recipient.currentStepId!);
    if (jobId) enqueued += 1;
  }

  if (due.length > 0) {
    logger.info(`campaign-step-tick: ${due.length} due, ${enqueued} newly enqueued.`);
  }
  return enqueued;
}
