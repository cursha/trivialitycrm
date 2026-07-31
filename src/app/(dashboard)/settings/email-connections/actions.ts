"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { disconnectMailbox, getUsableAccessToken } from "@/lib/comms/connections";
import { encryptToken } from "@/lib/comms/token-crypto";
import { verifyTitanCredentials } from "@/lib/comms/providers/titan";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { providerSlugFromKind, PROVIDER_DISPLAY_NAMES } from "@/lib/comms/provider-kind";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { writeAuditEvent } from "@/lib/audit/log";

const PATH = "/settings/email-connections";
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function disconnectMailboxAction(): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "connect_mailbox");
  // Deliberately no target-user parameter — connect_mailbox is inherently
  // self-scoped (ProviderConnection.userId is unique per user), so this
  // action can only ever disconnect the caller's own mailbox, never
  // someone else's by passing a different id.
  await disconnectMailbox(user.id);
  revalidatePath(PATH);
}

export type ConnectTitanResult = { error: string } | { success: true };

/**
 * Titan's password-auth counterpart to the OAuth callback route — verifies
 * the credentials actually work (a real SMTP handshake, no message sent)
 * before ever writing them, same "never persist an unverified connection"
 * guarantee the OAuth flow gets for free from a successful code exchange.
 * Self-scoped to the caller, same reasoning as disconnectMailboxAction.
 */
export async function connectTitanAccount(email: string, password: string): Promise<ConnectTitanResult> {
  const user = await requireUser();
  requirePermission(user, "connect_mailbox");

  const trimmedEmail = email.trim();
  if (!EMAIL_FORMAT.test(trimmedEmail)) return { error: "Enter a valid email address." };
  if (!password) return { error: "Enter your Titan mailbox password." };

  try {
    await verifyTitanCredentials(trimmedEmail, password);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not verify these credentials." };
  }

  await prisma.providerConnection.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      provider: "TITAN",
      providerAccountEmail: trimmedEmail,
      encryptedAccessToken: encryptToken(password),
      encryptedRefreshToken: null,
      scopes: [],
      tokenExpiresAt: null,
      status: "CONNECTED",
    },
    update: {
      provider: "TITAN",
      providerAccountEmail: trimmedEmail,
      encryptedAccessToken: encryptToken(password),
      encryptedRefreshToken: null,
      scopes: [],
      tokenExpiresAt: null,
      status: "CONNECTED",
      lastError: null,
      disconnectedAt: null,
    },
  });

  revalidatePath(PATH);
  return { success: true };
}

export type SendTestEmailResult = { error: string } | { success: true };

/**
 * Sends a one-off test email to the caller's own connected address — the
 * per-connection counterpart to the Integrations page's transactional-
 * provider test-send (src/app/(dashboard)/administration/integrations/
 * actions.ts), same rate-limit/audit-event shape but exercising this
 * user's own mailbox connection instead of the system transactional
 * provider. Calls the provider directly rather than going through
 * sendEmail()/prepareSend() — this is a self-send confirming the
 * connection works, not lead outreach, so it needs none of that path's
 * Contact/consent/quiet-hours/unsubscribe-link machinery (the same
 * "account/transactional mail" exemption quiet-hours.ts's own doc comment
 * already carves out for an admin test-send).
 */
export async function sendConnectionTestEmail(): Promise<SendTestEmailResult> {
  const user = await requireUser();
  requirePermission(user, "connect_mailbox");

  const rateLimit = await checkRateLimit(`connection-test-email:${user.id}`, { windowMs: 60_000, limit: 3 });
  if (!rateLimit.allowed) return { error: "Too many test emails sent recently — wait a moment and try again." };

  const connection = await prisma.providerConnection.findUnique({ where: { userId: user.id } });
  if (!connection) return { error: "Connect a mailbox first." };

  try {
    const account = await getUsableAccessToken(user.id);
    const provider = getEmailProvider(providerSlugFromKind(connection.provider));
    await provider.sendEmail(account, {
      to: [connection.providerAccountEmail],
      subject: "Triviality CRM — connection test",
      bodyHtml: `<p>This confirms your ${PROVIDER_DISPLAY_NAMES[providerSlugFromKind(connection.provider)]} connection to Triviality CRM is working. If you're reading this, sending is set up correctly.</p>`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sending the test email failed.";
    await writeAuditEvent({ actorId: user.id, module: "comms", action: "mailbox_connection.test_email_failed", entityType: "ProviderConnection", entityId: connection.id, metadata: { error: message } });
    return { error: message };
  }

  await writeAuditEvent({ actorId: user.id, module: "comms", action: "mailbox_connection.test_email_sent", entityType: "ProviderConnection", entityId: connection.id });
  return { success: true };
}
