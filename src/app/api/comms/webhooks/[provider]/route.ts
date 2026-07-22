import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { isConnectableProvider, providerKindFromSlug } from "@/lib/comms/provider-kind";
import { findConnectionForVerifiedNotification, recordWebhookEventOnce } from "@/lib/comms/inbound-sync";
import { enqueueProcessInboundNotificationJob } from "@/lib/jobs/enqueue";

/**
 * Receives push notifications from Microsoft Graph (and, once Gmail
 * inbound sync is implemented, Google Pub/Sub) for new inbox mail. Does
 * only fast, local-DB work before responding — Graph specifically expects
 * a response within a few seconds and retries aggressively otherwise — so
 * the actual message fetch happens in the worker (see
 * process-inbound-notification.ts), not here. Every per-notification
 * failure (unknown subscription, bad clientState, duplicate delivery) is a
 * silent skip, never a distinct error response: this endpoint's response
 * body must never become an oracle an attacker can use to learn which
 * subscriptionIds or clientStates are valid.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isConnectableProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  const rateLimit = await checkRateLimit(`webhook:inbound:${provider}`, { windowMs: 60_000, limit: 120 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const url = new URL(request.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken !== null) {
    // Graph's subscription-creation handshake: echo the token back as
    // plain text within its timeout window, proving this endpoint is
    // reachable and controlled by whoever requested the subscription.
    return new NextResponse(validationToken, { status: 200, headers: { "content-type": "text/plain" } });
  }

  const rawBody = await request.text();
  const emailProvider = getEmailProvider(provider);

  let notifications;
  try {
    notifications = emailProvider.parseInboundWebhookPayload(rawBody);
  } catch (error) {
    logger.warn({ err: error, provider }, "inbound webhook: malformed notification payload");
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const providerKind = providerKindFromSlug(provider);
  for (const notification of notifications) {
    const connection = await findConnectionForVerifiedNotification(notification);
    if (!connection) {
      logger.warn({ provider }, "inbound webhook: notification did not verify against any known subscription, dropping");
      continue;
    }

    const isNew = await recordWebhookEventOnce(providerKind, notification.eventId);
    if (!isNew) continue;

    await enqueueProcessInboundNotificationJob(notification.eventId, {
      connectionId: connection.id,
      providerMessageId: notification.providerMessageId,
    });
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
