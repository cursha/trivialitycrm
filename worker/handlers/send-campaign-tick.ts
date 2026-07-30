import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { recordCampaignEvent } from "../../src/lib/campaigns/events";

/**
 * Runs every 5 minutes (see worker/main.ts) — the campaign-lifecycle tick,
 * distinct from campaign-step-tick.ts's per-recipient step progression.
 * Finds every Campaign still SCHEDULED whose scheduledFor has passed,
 * flips it to QUEUED, and arms every ACTIVE recipient's first step to fire
 * immediately (nextStepDueAt = now) — campaign-step-tick then picks those
 * up on its own next pass. Same "the user picked a specific time"
 * timeliness reason as send-scheduled-email-tick.
 */
export async function runSendCampaignTick(): Promise<number> {
  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    select: { id: true },
  });

  for (const row of due) {
    await prisma.$transaction(async (tx) => {
      await tx.campaign.update({ where: { id: row.id }, data: { status: "QUEUED", sendingStartedAt: new Date() } });
      await tx.campaignRecipient.updateMany({
        where: { campaignId: row.id, status: "ACTIVE" },
        data: { nextStepDueAt: new Date() },
      });
      await recordCampaignEvent(tx, { campaignId: row.id, type: "QUEUED", metadata: { mode: "scheduled" } });
    });
  }

  if (due.length > 0) {
    logger.info(`send-campaign-tick: ${due.length} campaign(s) started.`);
  }
  return due.length;
}
