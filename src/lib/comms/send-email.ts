// No `import "server-only"` — the scheduled-send and sequence-step worker
// handlers call these exact functions to actually perform a send; same
// reasoning as every other Module Six file the worker will eventually need.
import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/client";
import type { ProviderKind } from "@/generated/prisma/enums";
import { getEnv } from "@/lib/env";
import { getUsableAccessToken } from "@/lib/comms/connections";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { providerSlugFromKind } from "@/lib/comms/provider-kind";
import { validateOutgoingEmail } from "@/lib/comms/validate";
import { resolveTemplatePlaceholders, hasUnsubscribePlaceholder } from "@/lib/comms/templates";
import { createUnsubscribeToken } from "@/lib/comms/unsubscribe-token";
import { sanitizeEmailHtml } from "@/lib/comms/sanitize-html";
import { logEmailSent } from "@/lib/comms/activity-log";
import { getQuietHoursWindow, isWithinQuietHours, quietHoursEndInstant } from "@/lib/comms/quiet-hours";

export type SendEmailParams = {
  userId: string;
  companyId: string;
  /** Required — every send must be tied to a tracked Contact so consent can
   * actually be checked. There is no "ad hoc address" path: a recipient the
   * CRM doesn't track as a contact has no ConsentRecord to check permission
   * against, so it can never be sent to (add them as a contact first). */
  contactId: string;
  templateId?: string | null;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Snapshot of standard/added links (see EmailTemplateLink and the
   * email-system delta plan's link-based-attachments design) to store on
   * the EmailMessage row as-is — not part of placeholder resolution or the
   * consent/quiet-hours gate, just accompanying metadata rendered
   * alongside the message. */
  links?: { label: string; url: string }[];
  /** Defaults true. A sequence step passes false — it records its own
   * single, unified failure notification covering both a prepareSend gate
   * rejection and a delivery failure, so sendEmail()'s own
   * DELIVERY_FAILURE notification would otherwise double up. */
  notifyOnFailure?: boolean;
};

export type SendEmailOutcome = { ok: true; emailMessageId: string } | { ok: false; error: string };

type PreparedSend = {
  to: string[];
  resolvedSubject: string;
  resolvedBody: string;
  connection: { id: string; provider: ProviderKind };
  companyName: string;
  /** Snapshot of the template's own EmailTemplate.pipelineStageId, if a
   * template was used and it has one — null otherwise. Computed fresh here
   * (never trusted from an earlier check) for the same reason subject/body
   * placeholder resolution is: the template can be edited between when a
   * send is scheduled and when it's actually due. */
  suggestedPipelineStageId: string | null;
};

/**
 * The opt-out gate + placeholder resolution every send path shares (the
 * composer's immediate send, a scheduled send, and a sequence-step send).
 * Re-run in full at the moment a send actually happens — never trusted
 * from an earlier check — because state (doNotContact, connection status)
 * can change between when a send is scheduled/enrolled and when it's due.
 *
 * `Company.doNotContact`/`Contact.doNotContact` are enforced — an explicit
 * opt-out is always respected — but there is deliberately no upfront
 * express-consent gate (`Contact.emailPermitted` is tracked but not
 * enforced here): outreach targets new leads who have not granted prior
 * permission by definition. The "To" address is never taken from caller
 * input — it's always the contact's own recorded email, resolved
 * server-side.
 */
async function prepareSend(params: {
  userId: string;
  companyId: string;
  contactId: string;
  templateId?: string | null;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}): Promise<{ ok: true; prepared: PreparedSend } | { ok: false; error: string }> {
  const [company, contact, sender, workspaceSettings, connection, template] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { name: true, doNotContact: true } }),
    prisma.contact.findUnique({
      where: { id: params.contactId },
      select: { id: true, firstName: true, lastName: true, email: true, emailPermitted: true, doNotContact: true, status: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: params.userId }, select: { name: true } }),
    prisma.workspaceSettings.findUnique({ where: { id: 1 }, select: { mailingAddress: true, quietHoursStartHour: true, quietHoursEndHour: true } }),
    prisma.providerConnection.findUnique({ where: { userId: params.userId } }),
    params.templateId ? prisma.emailTemplate.findUnique({ where: { id: params.templateId }, select: { pipelineStageId: true } }) : null,
  ]);

  if (company.doNotContact) {
    return { ok: false, error: "This company is marked Do Not Contact." };
  }
  if (!contact || contact.status === "MERGED") {
    return { ok: false, error: "Contact not found." };
  }
  if (!contact.email) {
    return { ok: false, error: "This contact has no email address on file." };
  }
  if (contact.doNotContact) {
    return { ok: false, error: "This contact has opted out of email." };
  }
  // Module Nine: business-wide quiet hours (CRM outreach only — see
  // src/lib/comms/quiet-hours.ts's doc comment for why transactional/system
  // email is exempt). An immediate send is refused outright here; a
  // scheduled/sequence send never reaches this function at all during
  // quiet hours — see processDueScheduledEmail/processDueSequenceStep,
  // which defer instead, before ever calling prepareSend.
  const quietHoursWindow =
    workspaceSettings?.quietHoursStartHour != null && workspaceSettings?.quietHoursEndHour != null
      ? { startHour: workspaceSettings.quietHoursStartHour, endHour: workspaceSettings.quietHoursEndHour }
      : null;
  if (isWithinQuietHours(quietHoursWindow)) {
    return { ok: false, error: `Sending is currently outside business hours (quiet hours: ${quietHoursWindow!.startHour}:00–${quietHoursWindow!.endHour}:00). Schedule this send instead.` };
  }
  // No CASL/express-consent gate here by design — outreach targets new
  // leads who haven't (and won't have) granted prior permission. doNotContact
  // above still blocks anyone who has explicitly opted out, and every send
  // still requires an unsubscribe link. A template can't be saved without
  // one, but a from-scratch composer send has no template to enforce it —
  // rather than block that send and make the sender go add the placeholder
  // by hand, silently append a standard footer containing it. Still
  // impossible to send a CAN-SPAM-noncompliant email either way; this just
  // moves the guarantee from "reject" to "always provide," matching every
  // sent message here always having ended up with a working link either
  // way.
  const bodyWithUnsubscribe = hasUnsubscribePlaceholder(params.body)
    ? params.body
    : `${params.body}<p style="margin-top:24px;font-size:12px;color:#888888;">Unsubscribe: {{unsubscribeLink}}</p>`;
  if (!connection || connection.status !== "CONNECTED") {
    return { ok: false, error: "Connect a mailbox before sending email." };
  }

  const to = [contact.email];
  const unsubscribeLink = `${getEnv().APP_URL ?? "http://localhost:3000"}/unsubscribe?token=${createUnsubscribeToken(contact.id)}`;
  const placeholderData = {
    contact,
    company,
    sender: { name: sender.name, mailingAddress: workspaceSettings?.mailingAddress ?? null },
    unsubscribeLink,
  };
  const subjectResolution = resolveTemplatePlaceholders(params.subject, placeholderData, "text");
  const bodyResolution = resolveTemplatePlaceholders(bodyWithUnsubscribe, placeholderData, "html");
  const unresolved = [...new Set([...subjectResolution.unresolved, ...bodyResolution.unresolved])];
  if (unresolved.length > 0) {
    return { ok: false, error: `Unresolved placeholder(s): ${unresolved.map((t) => `{{${t}}}`).join(", ")}` };
  }

  const recipientValidation = validateOutgoingEmail({ to, cc: params.cc, bcc: params.bcc, subject: subjectResolution.resolved });
  if (!recipientValidation.valid) {
    return { ok: false, error: recipientValidation.errors.join(" ") };
  }

  return {
    ok: true,
    prepared: {
      to,
      resolvedSubject: subjectResolution.resolved,
      resolvedBody: bodyResolution.resolved,
      connection: { id: connection.id, provider: connection.provider },
      companyName: company.name,
      suggestedPipelineStageId: template?.pipelineStageId ?? null,
    },
  };
}

/**
 * Attempts the actual provider call for an already-created `EmailMessage`
 * row and finalizes it (SENT + activity, or FAILED + a notification of
 * `notificationType`). Shared by the immediate-send and
 * scheduled/sequence-send paths so both produce identical audit trails.
 */
async function attemptDelivery(
  emailMessageId: string,
  params: { userId: string; companyId: string; cc?: string[]; bcc?: string[] },
  prepared: PreparedSend,
  notificationType: NotificationType | null,
  /** True only for a scheduled/sequence send (processDueScheduledEmail) —
   * an immediate send's own composer is right there to show the confirm
   * prompt inline once this call returns, so it needs no notification; a
   * background send does, since nobody is watching (spec section 13: "for
   * a scheduled message, do not change the stage silently after background
   * sending — create an in-app notification asking the sender to confirm"). */
  notifyStageSuggestion = false,
): Promise<SendEmailOutcome> {
  try {
    const account = await getUsableAccessToken(params.userId);
    const provider = getEmailProvider(providerSlugFromKind(prepared.connection.provider));
    const result = await provider.sendEmail(account, {
      to: prepared.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: prepared.resolvedSubject,
      bodyHtml: sanitizeEmailHtml(prepared.resolvedBody),
    });

    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({
        where: { id: emailMessageId },
        data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId, providerThreadId: result.providerThreadId },
      });
      await logEmailSent(tx, { companyId: params.companyId, userId: params.userId, subject: prepared.resolvedSubject, toAddresses: prepared.to });

      if (notifyStageSuggestion && prepared.suggestedPipelineStageId) {
        const stage = await tx.pipelineStage.findUnique({ where: { id: prepared.suggestedPipelineStageId }, select: { name: true } });
        await tx.notification.create({
          data: {
            userId: params.userId,
            type: "SCHEDULED_EMAIL_STAGE_SUGGESTED",
            payload: { emailMessageId, companyId: params.companyId, companyName: prepared.companyName, suggestedStageName: stage?.name ?? null },
          },
        });
      }
    });

    return { ok: true, emailMessageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed.";
    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({ where: { id: emailMessageId }, data: { status: "FAILED", errorMessage: message } });
      if (notificationType) {
        await tx.notification.create({
          data: {
            userId: params.userId,
            type: notificationType,
            payload: { emailMessageId, companyName: prepared.companyName, subject: prepared.resolvedSubject, error: message },
          },
        });
      }
    });
    return { ok: false, error: message };
  }
}

/** Sends immediately — the composer's path. No `EmailMessage` row is
 * created for a validation failure (nothing to show the user in that
 * case); a row is only ever created once the send is actually attempted. */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailOutcome> {
  const result = await prepareSend(params);
  if (!result.ok) return result;
  const { prepared } = result;

  const emailMessage = await prisma.emailMessage.create({
    data: {
      companyId: params.companyId,
      contactId: params.contactId,
      providerConnectionId: prepared.connection.id,
      toAddresses: prepared.to,
      ccAddresses: params.cc ?? [],
      bccAddresses: params.bcc ?? [],
      subject: prepared.resolvedSubject,
      body: prepared.resolvedBody,
      templateId: params.templateId ?? null,
      links: params.links && params.links.length > 0 ? params.links : undefined,
      suggestedPipelineStageId: prepared.suggestedPipelineStageId,
      status: "QUEUED",
      createdById: params.userId,
    },
  });

  return attemptDelivery(emailMessage.id, params, prepared, params.notifyOnFailure === false ? null : "DELIVERY_FAILURE");
}

export type ScheduleEmailParams = SendEmailParams & { scheduledFor: Date };
export type ScheduleEmailOutcome = { ok: true; emailMessageId: string } | { ok: false; error: string };

/**
 * Validates now (for immediate feedback) but does NOT send — creates a
 * `SCHEDULED` `EmailMessage` storing the raw, unresolved subject/body
 * (placeholders like `{{unsubscribeLink}}` are re-resolved fresh at actual
 * send time, not frozen at schedule time, since consent/connection state
 * can change in between). `processDueScheduledEmail` is what actually
 * sends it once due.
 */
export async function scheduleEmail(params: ScheduleEmailParams): Promise<ScheduleEmailOutcome> {
  const result = await prepareSend(params);
  if (!result.ok) return result;

  const emailMessage = await prisma.emailMessage.create({
    data: {
      companyId: params.companyId,
      contactId: params.contactId,
      toAddresses: result.prepared.to,
      ccAddresses: params.cc ?? [],
      bccAddresses: params.bcc ?? [],
      subject: params.subject,
      body: params.body,
      templateId: params.templateId ?? null,
      links: params.links && params.links.length > 0 ? params.links : undefined,
      status: "SCHEDULED",
      scheduledFor: params.scheduledFor,
      createdById: params.userId,
    },
  });

  return { ok: true, emailMessageId: emailMessage.id };
}

/**
 * Called by the `send-scheduled-email` worker job for one due `EmailMessage`
 * row. Re-runs the full gate fresh — a scheduled send whose contact
 * withdrew consent (or whose mailbox got disconnected) in the meantime is
 * marked FAILED with that reason, never silently sent anyway. A no-op
 * (returns ok without doing anything) if the row isn't still `SCHEDULED`
 * — already sent, already cancelled, or reprocessed by an overlapping tick.
 */
export async function processDueScheduledEmail(emailMessageId: string): Promise<SendEmailOutcome> {
  const row = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
  if (row.status !== "SCHEDULED") {
    return { ok: true, emailMessageId };
  }
  if (!row.contactId || !row.createdById || !row.companyId) {
    // A scheduled *outbound* send always has all three (set at schedule
    // time by scheduleEmail() — see that function) — companyId only goes
    // null on an *inbound* row (Phase D2's unmatched-sender case), which
    // is never SCHEDULED, so this branch is a data-integrity guard, not a
    // real expected path.
    await prisma.emailMessage.update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: "Missing contact, creator, or company." } });
    return { ok: false, error: "Missing contact, creator, or company." };
  }

  // Module Nine: quiet hours defer rather than fail a scheduled send —
  // pushes scheduledFor to the window's end and leaves status SCHEDULED, so
  // the next send-scheduled-email-tick naturally re-offers it once quiet
  // hours end. Checked before prepareSend so a deferral is never recorded
  // as a delivery failure.
  const quietHoursWindow = await getQuietHoursWindow();
  if (isWithinQuietHours(quietHoursWindow)) {
    await prisma.emailMessage.update({ where: { id: row.id }, data: { scheduledFor: quietHoursEndInstant(quietHoursWindow!) } });
    return { ok: true, emailMessageId: row.id };
  }

  const result = await prepareSend({
    userId: row.createdById,
    companyId: row.companyId,
    contactId: row.contactId,
    templateId: row.templateId,
    cc: row.ccAddresses,
    bcc: row.bccAddresses,
    subject: row.subject,
    body: row.body,
  });

  if (!result.ok) {
    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: result.error } });
      await tx.notification.create({
        data: {
          userId: row.createdById as string,
          type: "SCHEDULED_EMAIL_FAILED",
          payload: { emailMessageId: row.id, subject: row.subject, error: result.error },
        },
      });
    });
    return result;
  }

  await prisma.emailMessage.update({
    where: { id: row.id },
    data: {
      providerConnectionId: result.prepared.connection.id,
      subject: result.prepared.resolvedSubject,
      body: result.prepared.resolvedBody,
      suggestedPipelineStageId: result.prepared.suggestedPipelineStageId,
    },
  });

  return attemptDelivery(
    row.id,
    { userId: row.createdById, companyId: row.companyId, cc: row.ccAddresses, bcc: row.bccAddresses },
    result.prepared,
    "SCHEDULED_EMAIL_FAILED",
    true,
  );
}

/** Cancels a not-yet-sent scheduled email. A no-op (not an error) if it's
 * already been sent, failed, or cancelled — cancellation racing the tick is
 * expected, not exceptional. */
export async function cancelScheduledEmail(emailMessageId: string): Promise<void> {
  await prisma.emailMessage.updateMany({ where: { id: emailMessageId, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
}
