// No `import "server-only"` — the scheduled-send and sequence-step worker
// handlers call these exact functions to actually perform a send; same
// reasoning as every other Module Six file the worker will eventually need.
import { prisma } from "@/lib/prisma";
import type { NotificationType } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";
import { getUsableAccessToken } from "@/lib/comms/connections";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { providerSlugFromKind } from "@/lib/comms/provider-kind";
import { validateOutgoingEmail } from "@/lib/comms/validate";
import { resolveTemplatePlaceholders, hasUnsubscribePlaceholder } from "@/lib/comms/templates";
import { createUnsubscribeToken } from "@/lib/comms/unsubscribe-token";
import { textToSafeHtml } from "@/lib/comms/sanitize-html";
import { logEmailSent } from "@/lib/comms/activity-log";

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
  connection: { id: string; provider: "MICROSOFT" | "GOOGLE" };
  companyName: string;
};

/**
 * The consent gate + placeholder resolution every send path shares (the
 * composer's immediate send, a scheduled send, and a sequence-step send).
 * Re-run in full at the moment a send actually happens — never trusted
 * from an earlier check — because state (consent, connection status) can
 * change between when a send is scheduled/enrolled and when it's due.
 *
 * Two consent checks apply: `Company.doNotContact` (Phase A) and
 * `Contact.emailPermitted`/`doNotContact` (Phase B's CASL-safe
 * default-deny). The "To" address is never taken from caller input — it's
 * always the contact's own recorded email, resolved server-side, so a send
 * can never be pointed at some other address than the one consent was
 * actually recorded for.
 */
async function prepareSend(params: {
  userId: string;
  companyId: string;
  contactId: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}): Promise<{ ok: true; prepared: PreparedSend } | { ok: false; error: string }> {
  const [company, contact, sender, workspaceSettings, connection] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { name: true, doNotContact: true } }),
    prisma.contact.findUnique({
      where: { id: params.contactId },
      select: { id: true, firstName: true, lastName: true, email: true, emailPermitted: true, doNotContact: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: params.userId }, select: { name: true } }),
    prisma.workspaceSettings.findUnique({ where: { id: 1 }, select: { mailingAddress: true } }),
    prisma.providerConnection.findUnique({ where: { userId: params.userId } }),
  ]);

  if (company.doNotContact) {
    return { ok: false, error: "This company is marked Do Not Contact." };
  }
  if (!contact) {
    return { ok: false, error: "Contact not found." };
  }
  if (!contact.email) {
    return { ok: false, error: "This contact has no email address on file." };
  }
  if (contact.doNotContact) {
    return { ok: false, error: "This contact has opted out of email." };
  }
  if (!contact.emailPermitted) {
    return {
      ok: false,
      error: "This contact has not granted email permission — record consent from Settings → Communication Compliance before sending.",
    };
  }
  if (!hasUnsubscribePlaceholder(params.body)) {
    return { ok: false, error: "This email must include an unsubscribe link — use a template or add {{unsubscribeLink}} to the body." };
  }
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
  const subjectResolution = resolveTemplatePlaceholders(params.subject, placeholderData);
  const bodyResolution = resolveTemplatePlaceholders(params.body, placeholderData);
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
): Promise<SendEmailOutcome> {
  try {
    const account = await getUsableAccessToken(params.userId);
    const provider = getEmailProvider(providerSlugFromKind(prepared.connection.provider));
    const result = await provider.sendEmail(account, {
      to: prepared.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: prepared.resolvedSubject,
      bodyHtml: textToSafeHtml(prepared.resolvedBody),
    });

    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({
        where: { id: emailMessageId },
        data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId, providerThreadId: result.providerThreadId },
      });
      await logEmailSent(tx, { companyId: params.companyId, userId: params.userId, subject: prepared.resolvedSubject, toAddresses: prepared.to });
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
  if (!row.contactId || !row.createdById) {
    await prisma.emailMessage.update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: "Missing contact or creator." } });
    return { ok: false, error: "Missing contact or creator." };
  }

  const result = await prepareSend({
    userId: row.createdById,
    companyId: row.companyId,
    contactId: row.contactId,
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
    data: { providerConnectionId: result.prepared.connection.id, subject: result.prepared.resolvedSubject, body: result.prepared.resolvedBody },
  });

  return attemptDelivery(
    row.id,
    { userId: row.createdById, companyId: row.companyId, cc: row.ccAddresses, bcc: row.bccAddresses },
    result.prepared,
    "SCHEDULED_EMAIL_FAILED",
  );
}

/** Cancels a not-yet-sent scheduled email. A no-op (not an error) if it's
 * already been sent, failed, or cancelled — cancellation racing the tick is
 * expected, not exceptional. */
export async function cancelScheduledEmail(emailMessageId: string): Promise<void> {
  await prisma.emailMessage.updateMany({ where: { id: emailMessageId, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
}
