// No `import "server-only"` — Phase C's scheduled-send/sequence-step worker
// handlers call this exact function to actually perform a send; same
// reasoning as every other Module Six file the worker will eventually need.
import { prisma } from "@/lib/prisma";
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
};

export type SendEmailOutcome = { ok: true; emailMessageId: string } | { ok: false; error: string };

/**
 * The one place an email actually leaves this app — used by the composer's
 * send action today and, in Phase C, by the scheduled-send and
 * sequence-step worker jobs too, so every send path shares the exact same
 * consent gate, placeholder-resolution block, and recipient validation
 * rather than three independent copies that could drift apart.
 *
 * Two consent checks apply: `Company.doNotContact` (Phase A) and
 * `Contact.emailPermitted`/`doNotContact` (Phase B's CASL-safe
 * default-deny — a contact cannot receive email until a ConsentRecord has
 * established permission). The "To" address is never taken from caller
 * input — it's always the contact's own recorded email, resolved
 * server-side from the authoritative Contact row, so a send can never be
 * pointed at some other address than the one consent was actually recorded
 * for.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailOutcome> {
  const [company, contact, sender, workspaceSettings] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { name: true, doNotContact: true } }),
    prisma.contact.findUnique({
      where: { id: params.contactId },
      select: { id: true, firstName: true, lastName: true, email: true, emailPermitted: true, doNotContact: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: params.userId }, select: { name: true } }),
    prisma.workspaceSettings.findUnique({ where: { id: 1 }, select: { mailingAddress: true } }),
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

  const connection = await prisma.providerConnection.findUnique({ where: { userId: params.userId } });
  if (!connection || connection.status !== "CONNECTED") {
    return { ok: false, error: "Connect a mailbox before sending email." };
  }

  const emailMessage = await prisma.emailMessage.create({
    data: {
      companyId: params.companyId,
      contactId: params.contactId,
      providerConnectionId: connection.id,
      toAddresses: to,
      ccAddresses: params.cc ?? [],
      bccAddresses: params.bcc ?? [],
      subject: subjectResolution.resolved,
      body: bodyResolution.resolved,
      templateId: params.templateId ?? null,
      status: "QUEUED",
      createdById: params.userId,
    },
  });

  try {
    const account = await getUsableAccessToken(params.userId);
    const provider = getEmailProvider(providerSlugFromKind(connection.provider));
    const result = await provider.sendEmail(account, {
      to,
      cc: params.cc,
      bcc: params.bcc,
      subject: subjectResolution.resolved,
      bodyHtml: textToSafeHtml(bodyResolution.resolved),
    });

    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({
        where: { id: emailMessage.id },
        data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId, providerThreadId: result.providerThreadId },
      });
      await logEmailSent(tx, { companyId: params.companyId, userId: params.userId, subject: subjectResolution.resolved, toAddresses: to });
    });

    return { ok: true, emailMessageId: emailMessage.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed.";
    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({ where: { id: emailMessage.id }, data: { status: "FAILED", errorMessage: message } });
      await tx.notification.create({
        data: {
          userId: params.userId,
          type: "DELIVERY_FAILURE",
          payload: { emailMessageId: emailMessage.id, companyName: company.name, subject: subjectResolution.resolved, error: message },
        },
      });
    });
    return { ok: false, error: message };
  }
}
