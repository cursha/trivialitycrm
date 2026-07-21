// No `import "server-only"` — Phase C's scheduled-send/sequence-step worker
// handlers call this exact function to actually perform a send; same
// reasoning as every other Module Six file the worker will eventually need.
import { prisma } from "@/lib/prisma";
import { getUsableAccessToken } from "@/lib/comms/connections";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { providerSlugFromKind } from "@/lib/comms/provider-kind";
import { validateOutgoingEmail } from "@/lib/comms/validate";
import { resolveTemplatePlaceholders } from "@/lib/comms/templates";
import { textToSafeHtml } from "@/lib/comms/sanitize-html";
import { logEmailSent } from "@/lib/comms/activity-log";

export type SendEmailParams = {
  userId: string;
  companyId: string;
  contactId?: string | null;
  templateId?: string | null;
  to: string[];
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
 * The consent check here is `Company.doNotContact` — the one suppression
 * flag that exists today. Contact-level consent (`ConsentRecord`,
 * `Contact.emailPermitted`/`doNotContact`) is Phase B; once it lands this
 * function gains that check too, in addition to (not instead of) this one.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailOutcome> {
  const [company, contact, sender] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { name: true, doNotContact: true } }),
    params.contactId
      ? prisma.contact.findUnique({ where: { id: params.contactId }, select: { firstName: true, lastName: true, email: true } })
      : Promise.resolve(null),
    prisma.user.findUniqueOrThrow({ where: { id: params.userId }, select: { name: true } }),
  ]);

  if (company.doNotContact) {
    return { ok: false, error: "This company is marked Do Not Contact." };
  }

  const placeholderData = { contact: contact ?? undefined, company, sender };
  const subjectResolution = resolveTemplatePlaceholders(params.subject, placeholderData);
  const bodyResolution = resolveTemplatePlaceholders(params.body, placeholderData);
  const unresolved = [...new Set([...subjectResolution.unresolved, ...bodyResolution.unresolved])];
  if (unresolved.length > 0) {
    return { ok: false, error: `Unresolved placeholder(s): ${unresolved.map((t) => `{{${t}}}`).join(", ")}` };
  }

  const recipientValidation = validateOutgoingEmail({ to: params.to, cc: params.cc, bcc: params.bcc, subject: subjectResolution.resolved });
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
      contactId: params.contactId ?? null,
      providerConnectionId: connection.id,
      toAddresses: params.to,
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
      to: params.to,
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
      await logEmailSent(tx, { companyId: params.companyId, userId: params.userId, subject: subjectResolution.resolved, toAddresses: params.to });
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
