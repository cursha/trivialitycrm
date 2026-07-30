"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { writeAuditEvent, newCorrelationId } from "@/lib/audit/log";
import { salesListVisibilityWhere } from "@/lib/sales-lists/scope";
import { resolveCampaignRecipients, getCampaignById } from "@/lib/campaigns/queries";
import { getCampaignPersonalizationProvider } from "@/lib/campaigns/personalize";
import { firstStep } from "@/lib/campaigns/steps";
import { checkAiBudget } from "@/lib/ai/budget";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { enqueueRunCampaignStepJob } from "@/lib/jobs/enqueue";
import { recordCampaignEvent } from "@/lib/campaigns/events";

export type CampaignActionResult = { error: string } | { success: true; id: string };

async function requireManagedCampaign(
  user: Awaited<ReturnType<typeof requireUser>>,
  campaignId: string,
): Promise<{ error: string } | { campaign: NonNullable<Awaited<ReturnType<typeof getCampaignById>>> }> {
  const campaign = await getCampaignById(user, campaignId);
  if (!campaign) return { error: "Campaign not found." };
  if (campaign.createdById !== user.id && !hasPermission(user, "manage_all_sales_lists")) {
    return { error: "You do not have access to change this campaign." };
  }
  return { campaign };
}

export type CampaignStepInput = { instructions?: string; waitDays: number };

export async function createCampaign(input: {
  name: string;
  listId: string;
  campaignInstructions: string;
  reusableInstructionsId?: string;
  emailTemplateId?: string;
  stopOnPipelineStageIds?: string[];
  /** At least one step required — a single-email campaign is simply a
   * one-step campaign; waitDays on the first step is always treated as 0
   * (there is nothing to wait after before the campaign starts). */
  steps: CampaignStepInput[];
}): Promise<CampaignActionResult> {
  const user = await requireUser();
  requirePermission(user, "create_campaigns");

  const name = input.name.trim();
  if (!name) return { error: "Enter a name for this campaign." };
  if (!input.campaignInstructions.trim() && !input.reusableInstructionsId && !input.emailTemplateId) {
    return { error: "Provide campaign instructions, a reusable instruction set, or an approved template to guide the AI." };
  }
  if (!input.steps || input.steps.length === 0) return { error: "A campaign needs at least one step." };
  if (input.steps.some((s) => !Number.isInteger(s.waitDays) || s.waitDays < 0)) {
    return { error: "Each step's wait must be a whole number of days, 0 or more." };
  }

  const listScope = salesListVisibilityWhere(user);
  if (!listScope) return { error: "List not found." };
  const list = await prisma.salesList.findFirst({ where: { id: input.listId, ...listScope } });
  if (!list) return { error: "List not found." };
  if (list.purpose !== "EMAIL_CAMPAIGN") return { error: "Only an Email Campaign list can start a campaign." };

  const recipients = await resolveCampaignRecipients(user, list);
  if (recipients.length === 0) return { error: "This list has no companies." };
  if (!recipients.some((r) => r.eligible)) return { error: "No eligible recipients on this list right now." };

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        name,
        listId: list.id,
        createdById: user.id,
        campaignInstructions: input.campaignInstructions.trim() || null,
        reusableInstructionsId: input.reusableInstructionsId ?? null,
        emailTemplateId: input.emailTemplateId ?? null,
        stopOnPipelineStageIds: input.stopOnPipelineStageIds ?? [],
      },
    });
    await tx.campaignStep.createMany({
      data: input.steps.map((step, index) => ({
        campaignId: created.id,
        stepOrder: index + 1,
        waitDays: index === 0 ? 0 : step.waitDays,
        instructions: step.instructions?.trim() || null,
      })),
    });
    await tx.campaignRecipient.createMany({
      data: recipients.map((r) => ({
        campaignId: created.id,
        companyId: r.companyId,
        contactId: r.contactId,
        status: r.eligible ? "PENDING" : "SKIPPED",
        skipReason: r.skipReason,
      })),
    });
    return created;
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "campaigns",
    action: "campaign.created",
    entityType: "Campaign",
    entityId: campaign.id,
    metadata: {
      listId: list.id,
      stepCount: input.steps.length,
      recipientCount: recipients.length,
      eligibleCount: recipients.filter((r) => r.eligible).length,
    },
  });

  revalidatePath("/campaigns");
  return { success: true, id: campaign.id };
}

/**
 * Generates (or regenerates) the AI-personalized preview for every step of
 * the campaign, for every still-PENDING recipient — every step's message
 * is generated and frozen up front, not just the next one, so approving
 * the campaign means approving everything every recipient will ever
 * receive from it. Deliberately safe to re-run on a DRAFT campaign (e.g.
 * after editing instructions): existing snapshots are replaced, never
 * duplicated, and a campaign that's already been approved can no longer be
 * previewed at all (frozen).
 */
export async function generateCampaignPreview(campaignId: string): Promise<CampaignActionResult> {
  const user = await requireUser();
  requirePermission(user, "create_campaigns");

  const managed = await requireManagedCampaign(user, campaignId);
  if ("error" in managed) return managed;
  const campaign = managed.campaign;
  if (campaign.status !== "DRAFT") return { error: "This campaign has already been approved — its preview is frozen." };
  if (campaign.steps.length === 0) return { error: "This campaign has no steps to preview." };

  const budgetCheck = await checkAiBudget();
  if (!budgetCheck.allowed) return { error: budgetCheck.reason ?? "AI is currently unavailable." };

  const rateLimit = await checkRateLimit(`campaign-preview:${user.id}`, { windowMs: 5 * 60_000, limit: 10 });
  if (!rateLimit.allowed) return { error: "Too many preview requests — wait a moment and try again." };

  // Re-validate eligibility fresh (spec: "validate every recipient again
  // immediately before approval and immediately before sending" — this is
  // the "before preview" analog, since CRM data can change between list
  // creation and campaign creation/preview too) and sync any recipient
  // whose eligibility changed since the campaign was created.
  const fresh = await resolveCampaignRecipients(user, campaign.list);
  const freshById = new Map(fresh.map((r) => [r.companyId, r]));

  const provider = getCampaignPersonalizationProvider();
  let generated = 0;
  let budgetStoppedEarly = false;

  for (const recipient of campaign.recipients) {
    // Re-checked per recipient, not just once before this loop starts —
    // this loop can make hundreds of live provider calls (one per
    // recipient per step) for a large list, and checkAiBudget() above only
    // caught a breach that already existed before generation began. Same
    // reasoning as run-search.ts's per-candidate checkMidRunAiBudget()
    // recheck; this reuses checkAiBudget() itself (not that function, which
    // is LeadSearch-specific) since campaigns have no per-search cost cap.
    const midRunCheck = await checkAiBudget();
    if (!midRunCheck.allowed) {
      budgetStoppedEarly = true;
      break;
    }

    const current = freshById.get(recipient.companyId);
    if (!current || !current.eligible) {
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "SKIPPED", skipReason: current?.skipReason ?? "No longer on the list", contactId: null },
      });
      continue;
    }
    if (recipient.status === "SKIPPED" && current.eligible) {
      await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "PENDING", skipReason: null, contactId: current.contactId } });
    }
    if (recipient.status !== "PENDING" && recipient.status !== "SKIPPED") continue; // already ACTIVE/COMPLETED/stopped — never touched here

    const company = recipient.company;
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: current.contactId! } });
    const leadType = await prisma.leadType.findUniqueOrThrow({ where: { id: company.leadTypeId } });

    for (const step of campaign.steps) {
      const message = await provider.generate({
        company: {
          name: company.name,
          city: company.city,
          region: company.region,
          leadTypeName: leadType.name,
          scoreExplanation: company.scoreExplanation,
          verifiedEvidenceSummary: company.verifiedEvidenceSummary,
          triviaStatus: company.triviaStatus,
          competitorTriviaProvider: company.competitorTriviaProvider,
        },
        contact: { firstName: contact.firstName, lastName: contact.lastName, title: contact.title },
        campaignInstructions: step.instructions ?? campaign.campaignInstructions ?? "",
        reusableInstructions: campaign.reusableInstructions?.instructions ?? null,
        templateGuidance: campaign.emailTemplate ? `${campaign.emailTemplate.subject}\n\n${campaign.emailTemplate.body}` : null,
        userId: user.id,
      });

      await prisma.campaignMessageSnapshot.upsert({
        where: { recipientId_stepId: { recipientId: recipient.id, stepId: step.id } },
        create: { recipientId: recipient.id, stepId: step.id, subject: message.subject, body: message.body },
        update: { subject: message.subject, body: message.body, generatedAt: new Date() },
      });
      generated++;
    }
  }

  await writeAuditEvent({
    actorId: user.id,
    module: "campaigns",
    action: "campaign.preview_generated",
    entityType: "Campaign",
    entityId: campaignId,
    metadata: { generated, budgetStoppedEarly },
  });

  revalidatePath(`/campaigns/${campaignId}`);
  if (budgetStoppedEarly) {
    return { error: "AI budget was reached partway through — some recipients don't have a preview yet. Re-run preview once budget resets." };
  }
  return { success: true, id: campaignId };
}

/**
 * Freezes the campaign — per the spec, this is the point past which
 * "later CRM changes must not silently alter an approved message." Any
 * user with send_campaigns (not only the creator) may approve, per the
 * spec's "any user granted send_campaigns may approve and send a campaign" —
 * they become the campaign's sender, so they must have their own connected
 * mailbox. Re-validates every recipient one final time immediately before
 * freezing (the spec's "validate every recipient again immediately before
 * approval") and arms every eligible recipient to start at the campaign's
 * first step once send-now/schedule actually starts it.
 */
export async function approveCampaign(campaignId: string): Promise<CampaignActionResult> {
  const user = await requireUser();
  requirePermission(user, "send_campaigns");

  const listScope = salesListVisibilityWhere(user);
  if (!listScope) return { error: "Campaign not found." };
  const campaign = await getCampaignById(user, campaignId);
  if (!campaign) return { error: "Campaign not found." };
  if (campaign.status !== "DRAFT") return { error: "This campaign has already been approved." };
  const first = firstStep(campaign.steps);
  if (!first) return { error: "This campaign has no steps." };

  const connection = await prisma.providerConnection.findUnique({ where: { userId: user.id } });
  if (!connection || connection.status !== "CONNECTED") {
    return { error: "Connect a mailbox before approving a campaign — it will send from your own connected account." };
  }

  const fresh = await resolveCampaignRecipients(user, campaign.list);
  const freshById = new Map(fresh.map((r) => [r.companyId, r]));

  const missingPreview = await prisma.campaignRecipient.count({
    where: { campaignId, status: "PENDING", snapshots: { none: { stepId: first.id } } },
  });
  if (missingPreview > 0) return { error: "Generate a preview before approving — some recipients have no message yet." };

  await prisma.$transaction(async (tx) => {
    for (const recipient of campaign.recipients) {
      const current = freshById.get(recipient.companyId);
      if (recipient.status === "PENDING") {
        if (!current || !current.eligible) {
          await tx.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "SKIPPED", skipReason: current?.skipReason ?? "No longer on the list", contactId: null },
          });
        } else {
          await tx.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "ACTIVE", currentStepId: first.id, nextStepDueAt: null },
          });
        }
      }
    }
    await tx.campaign.update({
      where: { id: campaignId },
      data: { status: "APPROVED", senderId: user.id, approvedById: user.id, approvedAt: new Date() },
    });
  });

  const eligibleCount = await prisma.campaignRecipient.count({ where: { campaignId, status: "ACTIVE" } });
  if (eligibleCount === 0) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "FAILED", completedAt: new Date() } });
    await writeAuditEvent({ actorId: user.id, module: "campaigns", action: "campaign.approval_failed_no_recipients", entityType: "Campaign", entityId: campaignId });
    revalidatePath(`/campaigns/${campaignId}`);
    return { error: "Every recipient became ineligible before approval — nothing to send." };
  }

  await writeAuditEvent({ actorId: user.id, module: "campaigns", action: "campaign.approved", entityType: "Campaign", entityId: campaignId, metadata: { eligibleCount } });

  revalidatePath(`/campaigns/${campaignId}`);
  return { success: true, id: campaignId };
}

async function requireApprovedCampaignSender(
  user: Awaited<ReturnType<typeof requireUser>>,
  campaignId: string,
): Promise<{ error: string } | { campaign: NonNullable<Awaited<ReturnType<typeof getCampaignById>>> }> {
  const campaign = await getCampaignById(user, campaignId);
  if (!campaign) return { error: "Campaign not found." };
  if (campaign.senderId !== user.id) return { error: "Only the person who approved this campaign can send or schedule it." };
  return { campaign };
}

/** Arms every ACTIVE recipient's first step to fire now and enqueues a
 * job for each directly (not waiting on campaign-step-tick's up-to-5-minute
 * cadence) — the same immediacy the old single-send sendCampaignNow had. */
async function armAndEnqueueActiveRecipients(campaignId: string): Promise<void> {
  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaignId, status: "ACTIVE" },
    select: { id: true, currentStepId: true },
  });
  await prisma.campaignRecipient.updateMany({ where: { campaignId, status: "ACTIVE" }, data: { nextStepDueAt: new Date() } });
  for (const recipient of recipients) {
    if (recipient.currentStepId) await enqueueRunCampaignStepJob(recipient.id, recipient.currentStepId);
  }
}

export async function sendCampaignNow(campaignId: string): Promise<CampaignActionResult> {
  const user = await requireUser();
  requirePermission(user, "send_campaigns");

  const found = await requireApprovedCampaignSender(user, campaignId);
  if ("error" in found) return found;
  if (found.campaign.status !== "APPROVED") return { error: "This campaign is not ready to send." };

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "QUEUED", scheduledFor: null, sendingStartedAt: new Date() } });
  await armAndEnqueueActiveRecipients(campaignId);
  await recordCampaignEvent(prisma, { campaignId, type: "QUEUED", metadata: { mode: "now" } });

  await writeAuditEvent({ actorId: user.id, module: "campaigns", action: "campaign.queued", entityType: "Campaign", entityId: campaignId, metadata: { mode: "now" } });
  revalidatePath(`/campaigns/${campaignId}`);
  return { success: true, id: campaignId };
}

export async function scheduleCampaign(campaignId: string, scheduledFor: string): Promise<CampaignActionResult> {
  const user = await requireUser();
  requirePermission(user, "send_campaigns");

  const date = new Date(scheduledFor);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return { error: "Choose a valid future date and time." };

  const found = await requireApprovedCampaignSender(user, campaignId);
  if ("error" in found) return found;
  if (found.campaign.status !== "APPROVED") return { error: "This campaign is not ready to schedule." };

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "SCHEDULED", scheduledFor: date } });
  await recordCampaignEvent(prisma, { campaignId, type: "SCHEDULED", metadata: { scheduledFor: date.toISOString() } });

  await writeAuditEvent({ actorId: user.id, module: "campaigns", action: "campaign.scheduled", entityType: "Campaign", entityId: campaignId, metadata: { scheduledFor: date.toISOString() } });
  revalidatePath(`/campaigns/${campaignId}`);
  return { success: true, id: campaignId };
}

/**
 * Re-arms a recipient's FAILED *final* step for one more attempt —
 * deliberately restricted to a recipient's last step only (never a step in
 * the middle of a still-multi-step sequence): once a recipient reaches
 * COMPLETED, its steps are done in order, so retrying its very last
 * attempted step can never re-send anything out of order or skip ahead.
 * Preserves every earlier successful step's history untouched, matching
 * the spec's "a campaign with some failed messages must preserve all
 * successful results."
 */
export async function retryFailedRecipients(campaignId: string): Promise<CampaignActionResult> {
  const user = await requireUser();
  requirePermission(user, "send_campaigns");

  const found = await requireApprovedCampaignSender(user, campaignId);
  if ("error" in found) return found;
  const campaign = found.campaign;
  if (!["COMPLETED_WITH_WARNINGS", "FAILED"].includes(campaign.status)) {
    return { error: "Only a completed campaign with failures can be retried." };
  }

  const lastStepOrder = Math.max(...campaign.steps.map((s) => s.stepOrder));
  const lastStep = campaign.steps.find((s) => s.stepOrder === lastStepOrder);
  if (!lastStep) return { error: "This campaign has no steps." };

  const retryable = await prisma.campaignRecipientStepRun.findMany({
    where: { stepId: lastStep.id, status: "FAILED", recipient: { campaignId, status: "COMPLETED" } },
    select: { id: true, recipientId: true },
  });
  if (retryable.length === 0) return { error: "There are no failed recipients to retry." };

  await prisma.$transaction([
    prisma.campaignRecipientStepRun.deleteMany({ where: { id: { in: retryable.map((r) => r.id) } } }),
    prisma.campaignRecipient.updateMany({
      where: { id: { in: retryable.map((r) => r.recipientId) } },
      data: { status: "ACTIVE", currentStepId: lastStep.id, nextStepDueAt: new Date() },
    }),
    prisma.campaign.update({ where: { id: campaignId }, data: { status: "QUEUED", completedAt: null } }),
  ]);
  for (const recipient of retryable) {
    await enqueueRunCampaignStepJob(recipient.recipientId, lastStep.id);
  }

  await writeAuditEvent({ actorId: user.id, module: "campaigns", action: "campaign.retry_failed", entityType: "Campaign", entityId: campaignId, metadata: { retryCount: retryable.length } });
  revalidatePath(`/campaigns/${campaignId}`);
  return { success: true, id: campaignId };
}

/** Cancellable any time before/during sending — a still-PENDING or ACTIVE
 * recipient is marked CANCELLED (never sent, or never sent its next step),
 * but anything already sent is preserved untouched, per the spec's "a
 * campaign with some failed messages must preserve all successful
 * results." */
export async function cancelCampaign(campaignId: string): Promise<CampaignActionResult> {
  const user = await requireUser();
  requirePermission(user, "send_campaigns");

  const listScope = salesListVisibilityWhere(user);
  if (!listScope) return { error: "Campaign not found." };
  const campaign = await getCampaignById(user, campaignId);
  if (!campaign) return { error: "Campaign not found." };
  if (!["DRAFT", "APPROVED", "SCHEDULED", "QUEUED", "SENDING"].includes(campaign.status)) {
    return { error: "This campaign can no longer be cancelled." };
  }

  // Before approval there's no sender yet (senderId is only set by
  // approveCampaign), so ownership falls back to the creator — matching
  // requireManagedCampaign's rule. Once approved, only the sender (whose
  // own mailbox the campaign sends from) or an admin-equivalent may cancel
  // an in-flight send — matching sendCampaignNow/scheduleCampaign/
  // retryFailedRecipients, which all restrict to requireApprovedCampaignSender.
  const isOwner = campaign.status === "DRAFT" ? campaign.createdById === user.id : campaign.senderId === user.id;
  if (!isOwner && !hasPermission(user, "manage_all_sales_lists")) {
    return { error: "You do not have access to cancel this campaign." };
  }

  const correlationId = newCorrelationId();
  await prisma.$transaction([
    prisma.campaignRecipient.updateMany({
      where: { campaignId, status: { in: ["PENDING", "ACTIVE"] } },
      data: { status: "CANCELLED", stoppedAt: new Date(), stopReason: "Campaign cancelled", nextStepDueAt: null },
    }),
    prisma.campaign.update({ where: { id: campaignId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id } }),
  ]);

  await writeAuditEvent({ actorId: user.id, module: "campaigns", action: "campaign.cancelled", entityType: "Campaign", entityId: campaignId, correlationId });
  revalidatePath(`/campaigns/${campaignId}`);
  return { success: true, id: campaignId };
}
