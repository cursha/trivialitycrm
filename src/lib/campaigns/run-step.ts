// The worker-side counterpart to sequences.ts's processDueSequenceStep —
// same shape, generalized to a campaign's own recipient/step model
// (CampaignRecipient ≈ SequenceEnrollment, CampaignStep ≈ SequenceStep,
// CampaignRecipientStepRun ≈ SequenceStepRun). No `import "server-only"` —
// the run-campaign-step/campaign-step-tick worker handlers need every
// function here, same reasoning as every other worker-reachable module.
import { prisma } from "@/lib/prisma";
import { getUserById } from "@/lib/auth/current-user";
import { sendEmail } from "@/lib/comms/send-email";
import { getQuietHoursWindow, isWithinQuietHours } from "@/lib/comms/quiet-hours";
import { logger } from "@/lib/logger";
import { resolveCampaignRecipients } from "./queries";
import { stepAfter, isLastStep } from "./steps";
import { recordCampaignEvent } from "./events";
import type { CampaignRecipientStatus, CampaignEventType } from "@/generated/prisma/enums";

const STOP_EVENT_TYPE: Record<Extract<CampaignRecipientStatus, "STOPPED_OPT_OUT" | "STOPPED_STAGE" | "STOPPED_REPLY">, CampaignEventType> = {
  STOPPED_OPT_OUT: "UNSUBSCRIBED",
  STOPPED_STAGE: "SEQUENCE_STOPPED",
  STOPPED_REPLY: "REPLIED",
};

/**
 * Recomputes and, if the campaign is done, finalizes its overall status —
 * called after every recipient transition (advance/complete/stop/skip).
 * "Done" means no recipient is still ACTIVE (i.e. nothing will ever run
 * again for this campaign). Guarded by `status: { in: ["QUEUED",
 * "SENDING"] }` so two recipients finishing "simultaneously" only ever
 * finalize once — a race-safe no-op, not a lock.
 */
export async function finalizeCampaignIfDone(campaignId: string): Promise<void> {
  const stillActive = await prisma.campaignRecipient.count({ where: { campaignId, status: "ACTIVE" } });
  if (stillActive > 0) return;

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  if (!campaign || (campaign.status !== "QUEUED" && campaign.status !== "SENDING")) return;

  const [sentCount, failedCount, warningRecipientCount] = await Promise.all([
    prisma.campaignRecipientStepRun.count({ where: { recipient: { campaignId }, status: "SENT" } }),
    prisma.campaignRecipientStepRun.count({ where: { recipient: { campaignId }, status: "FAILED" } }),
    prisma.campaignRecipient.count({
      where: { campaignId, status: { in: ["SKIPPED", "STOPPED_OPT_OUT", "STOPPED_STAGE", "STOPPED_REPLY"] } },
    }),
  ]);

  const finalStatus =
    sentCount === 0 ? "FAILED" : failedCount > 0 || warningRecipientCount > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED";

  await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ["QUEUED", "SENDING"] } },
    data: { status: finalStatus, completedAt: new Date() },
  });

  logger.info({ campaignId, sentCount, failedCount, warningRecipientCount, finalStatus }, "campaign: finished");
}

async function stopRecipient(
  recipientId: string,
  campaignId: string,
  status: Extract<CampaignRecipientStatus, "STOPPED_OPT_OUT" | "STOPPED_STAGE" | "STOPPED_REPLY">,
  reason: string,
): Promise<void> {
  const updated = await prisma.campaignRecipient.updateMany({
    where: { id: recipientId, status: "ACTIVE" },
    data: { status, stopReason: reason, stoppedAt: new Date(), nextStepDueAt: null },
  });
  if (updated.count > 0) {
    await recordCampaignEvent(prisma, { campaignId, recipientId, type: STOP_EVENT_TYPE[status], metadata: { reason } });
  }
  await finalizeCampaignIfDone(campaignId);
}

/**
 * Called by inbound-sync (src/lib/comms/inbound-sync.ts) the moment a
 * newly-received message is matched to a contact — the campaign-side
 * counterpart to sequences.ts's stopEnrollmentsForReply, for exactly the
 * same reason: a reply isn't reflected in any eligibility flag
 * resolveCampaignRecipients checks, so without this explicit hook an
 * active campaign sequence would just keep emailing someone who already
 * replied. Stops every still-ACTIVE CampaignRecipient for this contact
 * across every campaign. Returns the stopped recipient ids so the caller
 * can decide whether a general "your lead replied" notification is still
 * needed.
 */
export async function stopCampaignRecipientsForReply(contactId: string): Promise<string[]> {
  const recipients = await prisma.campaignRecipient.findMany({ where: { contactId, status: "ACTIVE" } });
  for (const recipient of recipients) {
    await stopRecipient(recipient.id, recipient.campaignId, "STOPPED_REPLY", "The contact replied.");
  }
  return recipients.map((r) => r.id);
}

/**
 * Runs the one step (`stepId`) due for `recipientId` — called by the
 * run-campaign-step worker job. Re-checks stop conditions fresh (never
 * trusted from an earlier check): a company/contact that's no longer
 * eligible (do-not-contact, unsubscribed, permanent bounce, archived — see
 * evaluateCompanyEligibility, reused unchanged via resolveCampaignRecipients)
 * or that reached one of the campaign's admin-chosen stop stages ends this
 * recipient's sequence instead of sending the step. A no-op if the
 * recipient isn't ACTIVE or the step no longer matches its currentStepId —
 * both are safe outcomes of a race (recipient stopped/completed between
 * tick and job, or already advanced by an overlapping job), not errors.
 */
export async function processDueCampaignStep(recipientId: string, stepId: string): Promise<void> {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: { include: { steps: true, list: true } }, company: true },
  });
  if (!recipient || recipient.status !== "ACTIVE") return;
  if (recipient.currentStepId !== stepId) return;

  const step = recipient.campaign.steps.find((s) => s.id === stepId);
  if (!step) return;

  await prisma.campaign.updateMany({ where: { id: recipient.campaignId, status: "QUEUED" }, data: { status: "SENDING" } });

  if (!recipient.campaign.senderId) {
    logger.error({ campaignId: recipient.campaignId }, "run-campaign-step: campaign has no sender, cannot proceed");
    return;
  }
  const sender = await getUserById(recipient.campaign.senderId);
  if (!sender) return;

  // Fresh eligibility re-check immediately before this step sends — the
  // spec's "validate every recipient again ... immediately before
  // sending," now applied at every step, not just once.
  const fresh = await resolveCampaignRecipients(sender, recipient.campaign.list);
  const current = fresh.find((r) => r.companyId === recipient.companyId);
  if (!current || !current.eligible) {
    await stopRecipient(recipient.id, recipient.campaignId, "STOPPED_OPT_OUT", current?.skipReason ?? "No longer eligible");
    return;
  }
  if (recipient.campaign.stopOnPipelineStageIds.includes(recipient.company.pipelineStageId)) {
    await stopRecipient(recipient.id, recipient.campaignId, "STOPPED_STAGE", "The company reached this campaign's stop stage.");
    return;
  }

  const alreadyRun = await prisma.campaignRecipientStepRun.findUnique({ where: { recipientId_stepId: { recipientId, stepId } } });
  if (alreadyRun) return;

  // Quiet hours defer this step rather than fail it, mirroring
  // sequences.ts's processDueSequenceStep exactly: returning here without
  // creating a CampaignRecipientStepRun or advancing nextStepDueAt leaves
  // the recipient "due," so the next campaign-step-tick naturally re-offers
  // this same step once quiet hours end, instead of permanently failing it
  // (a FAILED run is unrecoverable — recipientId_stepId is @@unique).
  if (isWithinQuietHours(await getQuietHoursWindow())) {
    return;
  }

  const snapshot = await prisma.campaignMessageSnapshot.findUnique({ where: { recipientId_stepId: { recipientId, stepId } } });

  let runStatus: "SENT" | "FAILED" = "SENT";
  let errorMessage: string | null = null;
  let emailMessageId: string | null = null;

  if (!snapshot) {
    runStatus = "FAILED";
    errorMessage = "No personalized message was generated for this step.";
  } else {
    const result = await sendEmail({
      userId: sender.id,
      companyId: recipient.companyId,
      contactId: current.contactId!,
      subject: snapshot.subject,
      body: snapshot.body,
    });
    if (result.ok) {
      emailMessageId = result.emailMessageId;
    } else {
      runStatus = "FAILED";
      errorMessage = result.error;
    }
  }

  try {
    await prisma.campaignRecipientStepRun.create({ data: { recipientId, stepId, status: runStatus, errorMessage, emailMessageId } });
  } catch {
    // Unique-constraint race with another job attempt for the same step —
    // the other job already recorded this run.
    return;
  }
  await recordCampaignEvent(prisma, {
    campaignId: recipient.campaignId,
    recipientId,
    stepId,
    type: runStatus === "SENT" ? "SENT" : "FAILED",
    metadata: runStatus === "FAILED" ? { errorMessage } : undefined,
  });

  const reachedLastStep = isLastStep(recipient.campaign.steps, step.stepOrder);

  // A follow-up task is created once, when the recipient has run its final
  // step — not after every step of a drip, which would be noisy — since
  // that's the point a human needs to take over, whether or not the last
  // send itself succeeded.
  if (reachedLastStep) {
    const workspaceSettings = await prisma.workspaceSettings.findUnique({ where: { id: 1 } });
    const followUpDays = workspaceSettings?.defaultCampaignFollowUpDays ?? 3;
    await prisma.task.create({
      data: {
        companyId: recipient.companyId,
        assignedToId: recipient.company.assignedToId ?? sender.id,
        title: `Follow up on campaign email — ${recipient.campaign.name}`,
        dueAt: new Date(Date.now() + followUpDays * 24 * 60 * 60 * 1000),
      },
    });
  }

  const next = stepAfter(recipient.campaign.steps, step.stepOrder);
  if (!next) {
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { status: "COMPLETED", nextStepDueAt: null },
    });
  } else {
    await prisma.campaignRecipient.update({
      where: { id: recipientId },
      data: { currentStepId: next.id, nextStepDueAt: new Date(Date.now() + next.waitDays * 24 * 60 * 60 * 1000) },
    });
  }

  await finalizeCampaignIfDone(recipient.campaignId);
}
