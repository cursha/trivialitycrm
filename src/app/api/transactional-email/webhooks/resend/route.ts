import { NextResponse } from "next/server";
import { Webhook, WebhookVerificationError } from "svix";
import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { prisma } from "@/lib/prisma";
import { writeAuditEvent } from "@/lib/audit/log";
import type { WebhookEventPayload } from "resend";

/**
 * Receives Resend's delivery-events webhook (delivered/bounced/complained/
 * deferred) for transactional/system email — the one thing Module Six's
 * per-user OAuth mailbox model structurally cannot provide (see
 * MODULE_6_REPORT.md's Phase E gap notes). Resend signs every webhook with
 * a Svix-compatible HMAC (confirmed against the installed svix@1.99.1
 * package's own type defs — Webhook.verify() throws WebhookVerificationError
 * on an invalid, missing, or stale signature; Svix's own timestamp-tolerance
 * check inside verify() is the replay protection).
 *
 * Every failure path here — bad signature, unconfigured provider, unknown
 * message, malformed payload — is a safe generic response, never a detail
 * that could help an attacker probe this endpoint, and the raw webhook body
 * is never logged or persisted (only the fields actually needed: event
 * type, message id, timestamp, bounce/complaint reason).
 */
export async function POST(request: Request) {
  const env = getEnv();

  const rateLimit = await checkRateLimit("webhook:resend:transactional", { windowMs: 60_000, limit: 120 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  if (env.EMAIL_PROVIDER !== "resend" || !env.RESEND_WEBHOOK_SECRET) {
    // Not configured — same "unknown/unsupported" 404 the inbound comms
    // webhook uses for an unrecognized provider slug, so this response
    // shape can't be used to distinguish "wrong secret" from "not set up".
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const rawBody = await request.text();
  const svixHeaders = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let payload: WebhookEventPayload;
  try {
    payload = new Webhook(env.RESEND_WEBHOOK_SECRET).verify(rawBody, svixHeaders) as WebhookEventPayload;
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      logger.warn("resend webhook: signature verification failed, rejecting");
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
    logger.warn({ err: error }, "resend webhook: malformed payload");
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  // Svix's own message id (not anything inside the JSON body) is the
  // documented idempotency key for a webhook delivery — stable across
  // Resend's own retries of the same event.
  const providerEventId = svixHeaders["svix-id"];
  const isNew = await recordDeliveryEventOnce(providerEventId);
  if (!isNew) {
    return NextResponse.json({ accepted: true }, { status: 202 });
  }

  await applyDeliveryEvent(payload);

  return NextResponse.json({ accepted: true }, { status: 202 });
}

async function recordDeliveryEventOnce(providerEventId: string): Promise<boolean> {
  try {
    await prisma.emailDeliveryEvent.create({ data: { provider: "resend", providerEventId } });
    return true;
  } catch {
    // Unique constraint violation — already processed this exact delivery.
    return false;
  }
}

async function applyDeliveryEvent(payload: WebhookEventPayload): Promise<void> {
  // A switch on the discriminant (not a lookup table) so TypeScript narrows
  // payload.data's shape per case — email.bounced's `data.bounce` field
  // only exists on that variant of the union.
  switch (payload.type) {
    case "email.delivered": {
      await updateMessageStatus(payload.data.email_id, "DELIVERED");
      return;
    }
    case "email.delivery_delayed": {
      await updateMessageStatus(payload.data.email_id, "DEFERRED");
      return;
    }
    case "email.complained": {
      const message = await updateMessageStatus(payload.data.email_id, "COMPLAINED");
      if (message) await suppress(message.toAddress, "complaint");
      return;
    }
    case "email.bounced": {
      const message = await updateMessageStatus(payload.data.email_id, "BOUNCED");
      // Only a permanent/hard bounce suppresses future sends — a transient
      // bounce (mailbox full, temporary DNS issue) may well succeed on a
      // later, unrelated send and shouldn't block the address forever.
      if (message && payload.data.bounce.type?.toLowerCase() === "permanent") {
        await suppress(message.toAddress, "hard_bounce");
      }
      return;
    }
    default:
      // opened/clicked/sent/suppressed/contact.*/domain.* — outside this
      // app's tracked purpose, safely ignored.
      return;
  }
}

async function updateMessageStatus(
  providerMessageId: string,
  status: "DELIVERED" | "BOUNCED" | "COMPLAINED" | "DEFERRED",
): Promise<{ id: string; toAddress: string } | null> {
  const message = await prisma.transactionalEmailMessage.findUnique({ where: { providerMessageId }, select: { id: true, toAddress: true } });
  if (!message) return null; // event for a message this app didn't send (or already purged) — nothing to update

  await prisma.transactionalEmailMessage.update({ where: { id: message.id }, data: { status } });
  return message;
}

async function suppress(address: string, reason: "hard_bounce" | "complaint"): Promise<void> {
  const existing = await prisma.emailSuppression.findUnique({ where: { address } });
  if (existing) return; // already suppressed — nothing new to audit

  await prisma.emailSuppression.create({ data: { address, reason, source: "resend-webhook" } });
  await writeAuditEvent({
    actorId: null,
    module: "email-integration",
    action: "email_suppression.added",
    entityType: "EmailSuppression",
    entityId: address,
    metadata: { reason, source: "resend-webhook" },
  });
}
