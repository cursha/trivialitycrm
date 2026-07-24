// Module Nine: the transactional/system-email send pipeline — password
// reset links and an admin's own test send. Deliberately separate from
// src/lib/comms/send-email.ts's sendEmail()/prepareSend() (Module Six's
// per-user OAuth mailbox model for CRM outreach): a transactional send has
// no Contact/Company to attach to and no mailbox connection to use.
//
// No `import "server-only"` — the worker's send-system-email job handler
// needs this too; same reasoning as every other module in this tree (see
// src/lib/prisma.ts).
import { prisma } from "../prisma";
import { getEnv } from "../env";
import { validateEmailAddress, validateSubject } from "../comms/validate";
import { textToSafeHtml } from "../comms/sanitize-html";
import { checkRateLimit } from "../rate-limit/postgres-bucket";
import { enqueueSendSystemEmailJob } from "../jobs/enqueue";
import { getIntegrationSettings } from "../integrations/settings";
import { getTransactionalProvider } from "./factory";
import { classifyProviderError } from "../integrations/provider-errors";
import type { TransactionalEmailPurpose } from "../../generated/prisma/client";

export type SendSystemEmailParams = {
  purpose: TransactionalEmailPurpose;
  toAddress: string;
  subject: string;
  bodyText: string;
  /** Caller-supplied idempotency key — same value on a retried call returns
   * the already-queued/sent row rather than creating a second one. Callers
   * should derive this from something stable about the triggering event
   * (e.g. `password-reset:${tokenId}`, `admin-test:${auditCorrelationId}`),
   * never a fresh random value per call, or idempotency is defeated. */
  idempotencyKey: string;
  /** Null for system-triggered sends (password reset has no acting admin);
   * set for an admin's own test send. */
  createdById?: string | null;
};

export type SendSystemEmailOutcome = { ok: true; id: string } | { ok: false; error: string };

/**
 * Validates, checks suppression/enablement/rate limits, persists a QUEUED
 * TransactionalEmailMessage row, and enqueues its actual send through the
 * durable worker (never sent inline) — so a page reload or a retried caller
 * can never double-send. Mock mode (the default) is exempt from the
 * emailSendingEnabled check so dev/tests never need it flipped on.
 */
export async function sendSystemEmail(params: SendSystemEmailParams): Promise<SendSystemEmailOutcome> {
  const addressCheck = validateEmailAddress(params.toAddress);
  if (!addressCheck.valid) return { ok: false, error: addressCheck.reason };
  const subjectCheck = validateSubject(params.subject);
  if (!subjectCheck.valid) return { ok: false, error: subjectCheck.reason };

  const normalizedAddress = params.toAddress.trim().toLowerCase();

  const suppressed = await prisma.emailSuppression.findUnique({ where: { address: normalizedAddress } });
  if (suppressed) {
    return { ok: false, error: "This address is on the suppression list and cannot be sent to." };
  }

  const env = getEnv();
  if (env.EMAIL_PROVIDER !== "mock") {
    const settings = await getIntegrationSettings();
    if (!settings.emailSendingEnabled) {
      return { ok: false, error: "Live transactional email is currently disabled by an administrator." };
    }
  }

  const rateLimit = await checkRateLimit("transactional-email:send", { windowMs: 60_000, limit: 30 });
  if (!rateLimit.allowed) {
    return { ok: false, error: "Too many transactional emails sent recently — wait a moment and try again." };
  }

  const existing = await prisma.transactionalEmailMessage.findUnique({ where: { idempotencyKey: params.idempotencyKey } });
  if (existing) return { ok: true, id: existing.id };

  const message = await prisma.transactionalEmailMessage.create({
    data: {
      purpose: params.purpose,
      toAddress: normalizedAddress,
      subject: params.subject,
      body: params.bodyText,
      status: "QUEUED",
      idempotencyKey: params.idempotencyKey,
      createdById: params.createdById ?? null,
    },
  });

  await enqueueSendSystemEmailJob(message.id);
  return { ok: true, id: message.id };
}

/**
 * Called by the send-system-email worker job for one QUEUED row. A no-op if
 * the row isn't still QUEUED (already processed by an overlapping
 * attempt — mirrors processDueScheduledEmail's identical guard).
 */
export async function processQueuedSystemEmail(id: string): Promise<void> {
  const row = await prisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id } });
  if (row.status !== "QUEUED") return;

  try {
    const provider = getTransactionalProvider();
    const result = await provider.send({
      toAddress: row.toAddress,
      subject: row.subject,
      bodyText: row.body,
      bodyHtml: textToSafeHtml(row.body),
      idempotencyKey: row.idempotencyKey,
    });

    await prisma.transactionalEmailMessage.update({
      where: { id: row.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId },
    });
  } catch (error) {
    const classified = classifyProviderError(error);
    await prisma.transactionalEmailMessage.update({
      where: { id: row.id },
      data: { status: "FAILED", errorMessage: classified.safeMessage, failureCategory: classified.category },
    });
  }
}
