// No `import "server-only"` — the inbound-subscription-tick and
// process-inbound-notification worker handlers need every function here,
// same reasoning as every other Module Six comms module the worker
// consumes (see connections.ts's doc comment for the fuller history).
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getEnv } from "@/lib/env";
import { getUsableAccessToken } from "@/lib/comms/connections";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { providerSlugFromKind } from "@/lib/comms/provider-kind";
import { stopEnrollmentsForReply } from "@/lib/comms/sequences";
import { stopCampaignRecipientsForReply } from "@/lib/campaigns/run-step";
import type { ParsedInboundNotification } from "@/lib/comms/providers/types";
import type { ProviderKind } from "@/generated/prisma/enums";
import crypto from "node:crypto";

/** A subscription nearing this close to its expiry gets renewed — generous
 * enough that an hourly tick (see worker/main.ts) can never miss the
 * window even if a run or two is skipped (worker restart, slow tick). */
const RENEWAL_MARGIN_MS = 24 * 60 * 60 * 1000;

export function generateClientState(): string {
  return crypto.randomBytes(24).toString("hex");
}

function notificationUrlFor(providerSlug: "microsoft" | "google"): string {
  const { APP_URL } = getEnv();
  if (!APP_URL) {
    throw new Error("APP_URL is not configured — inbound sync needs a public base URL for the provider to call back on.");
  }
  return `${APP_URL}/api/comms/webhooks/${providerSlug}`;
}

/**
 * Ensures one connection has a live, non-expiring-soon inbound
 * subscription: creates one if it has none, renews one nearing expiry,
 * and leaves an already-fresh one alone. A connection whose provider
 * doesn't implement inbound sync yet (Google — see google.ts's doc
 * comments) throws from the provider call itself; this function lets that
 * propagate so the caller (runInboundSubscriptionTick) can log it per
 * connection without one connection's failure blocking every other one.
 */
export async function ensureInboundSubscription(connectionId: string): Promise<void> {
  const connection = await prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (connection.status !== "CONNECTED") return;

  const account = await getUsableAccessToken(connection.userId);
  const provider = getEmailProvider(providerSlugFromKind(connection.provider));

  const needsRenewal =
    !connection.inboundSubscriptionId ||
    !connection.inboundSubscriptionExpiresAt ||
    connection.inboundSubscriptionExpiresAt.getTime() - Date.now() < RENEWAL_MARGIN_MS;
  if (!needsRenewal) return;

  if (connection.inboundSubscriptionId) {
    const renewed = await provider.renewInboundSubscription(account, connection.inboundSubscriptionId);
    await prisma.providerConnection.update({
      where: { id: connectionId },
      data: { inboundSubscriptionExpiresAt: renewed.expiresAt },
    });
    return;
  }

  const clientState = generateClientState();
  const created = await provider.createInboundSubscription(
    account,
    notificationUrlFor(providerSlugFromKind(connection.provider)),
    clientState,
  );
  await prisma.providerConnection.update({
    where: { id: connectionId },
    data: {
      inboundSubscriptionId: created.subscriptionId,
      inboundSubscriptionExpiresAt: created.expiresAt,
      inboundClientState: clientState,
    },
  });
}

/**
 * Runs on an hourly tick (see worker/main.ts) — iterates every CONNECTED
 * connection and ensures its inbound subscription. Each connection's
 * failure (an unconfigured Google provider, a revoked token, a transient
 * provider error) is caught and logged individually, exactly like
 * disconnectMailbox's best-effort revoke — one bad connection must never
 * stop every other user's subscription from being created/renewed.
 */
export async function runInboundSubscriptionTick(): Promise<{ ok: number; failed: number }> {
  const connections = await prisma.providerConnection.findMany({ where: { status: "CONNECTED" }, select: { id: true } });

  let ok = 0;
  let failed = 0;
  for (const { id } of connections) {
    try {
      await ensureInboundSubscription(id);
      ok += 1;
    } catch (error) {
      failed += 1;
      logger.warn({ err: error, connectionId: id }, "inbound-subscription-tick: failed to ensure a subscription for this connection");
    }
  }
  return { ok, failed };
}

/**
 * Looks up the connection a notification's subscriptionId belongs to and
 * verifies its clientState matches what was actually stored when the
 * subscription was created — the receiver's proof this notification is
 * genuine, not a forged POST to the public webhook URL. Returns null for
 * any mismatch (unknown subscriptionId, wrong clientState) — callers
 * (the webhook route) must treat null as "silently drop," never surface
 * *why* verification failed to the caller, so a forged request can't be
 * used to probe which subscriptionIds are valid.
 */
export async function findConnectionForVerifiedNotification(
  notification: Pick<ParsedInboundNotification, "subscriptionId" | "clientState">,
): Promise<{ id: string } | null> {
  const connection = await prisma.providerConnection.findFirst({
    where: { inboundSubscriptionId: notification.subscriptionId },
    select: { id: true, inboundClientState: true },
  });
  if (!connection || !connection.inboundClientState) return null;
  if (connection.inboundClientState !== notification.clientState) return null;
  return { id: connection.id };
}

/**
 * Records this notification's WebhookEvent row as a fast, DB-only dedupe
 * gate — no provider/network call is made here. Returns false if this
 * exact (provider, eventId) pair was already recorded (a genuine
 * redelivery, which both Graph and Google document as expected), true if
 * this is the first time it's been seen and it's now safe to enqueue
 * real processing.
 */
export async function recordWebhookEventOnce(provider: ProviderKind, eventId: string): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({ data: { provider, providerEventId: eventId } });
    return true;
  } catch {
    // Unique-constraint violation — already recorded, not an error.
    return false;
  }
}

/**
 * Recognizes a Non-Delivery Report (bounce), not a real reply. Neither
 * Microsoft Graph nor Gmail expose a dedicated "delivery status" webhook
 * for mail sent from a regular delegated mailbox (that's a transactional-
 * ESP-only feature) — a bounce instead arrives as an ordinary inbound
 * email from the mail system itself. This is a best-effort heuristic on
 * sender address and subject line, not a parse of the message's MIME
 * structure (a real RFC 3464 `multipart/report` isn't reachable through
 * the simple `$select=from,subject,body` fetch this module uses) — see
 * MODULE_6_REPORT.md's Phase E section for this documented as a known
 * limitation, not silently assumed reliable.
 */
export function isBounceMessage(message: { fromAddress: string; subject: string }): boolean {
  if (/^(postmaster|mailer-daemon)@/i.test(message.fromAddress)) return true;
  return /^(undeliverable|delivery (has failed|status notification)|mail delivery failed|returned mail)/i.test(message.subject);
}

/**
 * Links a recognized bounce back to the sent message it's bouncing —
 * matched by `providerThreadId` (Graph's conversationId; the NDR lands in
 * the same conversation as the message that triggered it) plus the same
 * `providerConnectionId`, picking the most recent still-`SENT` message in
 * that thread if more than one exists. Flips it to `BOUNCED` and notifies
 * whoever sent it. Returns whether a match was found — when it isn't (no
 * `providerThreadId` on the bounce, or no matching sent message), the
 * bounce is logged and otherwise dropped rather than guessed at.
 */
async function linkBounceToOriginalSend(
  connection: { id: string; userId: string },
  message: { providerThreadId?: string; subject: string },
): Promise<boolean> {
  if (!message.providerThreadId) return false;

  const original = await prisma.emailMessage.findFirst({
    where: { providerConnectionId: connection.id, providerThreadId: message.providerThreadId, direction: "OUTBOUND", status: "SENT" },
    orderBy: { createdAt: "desc" },
    select: { id: true, companyId: true, subject: true, createdById: true },
  });
  if (!original) return false;

  await prisma.emailMessage.update({
    where: { id: original.id },
    data: { status: "BOUNCED", errorMessage: "This message bounced (a delivery failure notice was received)." },
  });

  if (original.createdById) {
    const company = original.companyId ? await prisma.company.findUnique({ where: { id: original.companyId }, select: { name: true } }) : null;
    await prisma.notification.create({
      data: {
        userId: original.createdById,
        type: "EMAIL_BOUNCED",
        payload: { emailMessageId: original.id, companyName: company?.name, subject: original.subject },
      },
    });
  }

  return true;
}

export type ContactMatch = { contactId: string; companyId: string };

/**
 * Matches an inbound sender address to exactly one Contact, case-
 * insensitively. Zero matches (unknown sender) or more than one match
 * (the same address reused across different companies' contacts — rare
 * but possible, e.g. a shared front-desk inbox) are both treated as
 * "unmatched" — the plan's explicit "never auto-create a company from an
 * unknown sender" requirement extends naturally to "never guess when the
 * match is ambiguous," surfacing both cases to
 * /settings/communications-review for a human to resolve instead.
 */
export async function matchContactForAddress(address: string): Promise<ContactMatch | null> {
  const matches = await prisma.contact.findMany({
    where: { email: { equals: address, mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, companyId: true },
    take: 2,
  });
  if (matches.length !== 1) return null;
  return { contactId: matches[0].id, companyId: matches[0].companyId };
}

/**
 * The actual work behind the process-inbound-notification worker job:
 * fetches the message's real content and either (a) links it to one of
 * our own sent messages as a bounce (see isBounceMessage/
 * linkBounceToOriginalSend — no EmailMessage row is created for the bounce
 * itself, only the original sent message's status changes), or (b) writes
 * a new inbound EmailMessage row (matched or unmatched — see
 * matchContactForAddress) and, only for a matched contact, stops any
 * active/paused sequence enrollment via stopEnrollmentsForReply and any
 * active campaign recipient via stopCampaignRecipientsForReply.
 * Idempotent at the message-content level too: EmailMessage's
 * (providerConnectionId, providerMessageId) unique constraint means a
 * duplicate call for the same message (the job queue's own singletonKey
 * should already prevent this, but a retried job after a partial failure
 * is a real scenario) is a safe no-op, not a duplicate row.
 */
export async function processInboundNotification(params: { connectionId: string; providerMessageId: string }): Promise<void> {
  const connection = await prisma.providerConnection.findUnique({ where: { id: params.connectionId } });
  if (!connection || connection.status !== "CONNECTED") {
    logger.warn({ connectionId: params.connectionId }, "process-inbound-notification: connection is gone or disconnected, dropping");
    return;
  }

  const account = await getUsableAccessToken(connection.userId);
  const provider = getEmailProvider(providerSlugFromKind(connection.provider));
  const message = await provider.fetchInboundMessage(account, params.providerMessageId);

  if (isBounceMessage(message)) {
    const linked = await linkBounceToOriginalSend(connection, message);
    if (!linked) {
      logger.warn({ connectionId: connection.id }, "process-inbound-notification: recognized a bounce but found no matching sent message");
    }
    return;
  }

  const match = await matchContactForAddress(message.fromAddress);

  try {
    await prisma.emailMessage.create({
      data: {
        companyId: match?.companyId ?? null,
        contactId: match?.contactId ?? null,
        direction: "INBOUND",
        providerConnectionId: connection.id,
        fromAddress: message.fromAddress,
        toAddresses: [connection.providerAccountEmail],
        subject: message.subject,
        body: message.bodyHtml,
        status: "RECEIVED",
        providerMessageId: message.providerMessageId,
        providerThreadId: message.providerThreadId,
      },
    });
  } catch {
    // Unique-constraint race on (providerConnectionId, providerMessageId)
    // — another job attempt already recorded this exact message.
    return;
  }

  if (match) {
    const [stoppedSequences] = await Promise.all([
      stopEnrollmentsForReply(match.contactId),
      stopCampaignRecipientsForReply(match.contactId),
    ]);
    if (stoppedSequences.length === 0) {
      // stopEnrollmentsForReply notifies per stopped sequence enrollment
      // itself, so the fallback below only needs to cover the cases it
      // doesn't: no active sequence at all, or only an active campaign
      // recipient — stopCampaignRecipientsForReply doesn't send its own
      // notification, so without this the salesperson would never hear
      // about a reply that only stopped a campaign, not a sequence.
      // Notify whoever owns the lead, falling back to the mailbox owner
      // if the company is unassigned.
      const company = await prisma.company.findUnique({ where: { id: match.companyId }, select: { assignedToId: true } });
      await prisma.notification.create({
        data: {
          userId: company?.assignedToId ?? connection.userId,
          type: "NEW_REPLY",
          payload: { contactId: match.contactId, companyId: match.companyId },
        },
      });
    }
  }
}
