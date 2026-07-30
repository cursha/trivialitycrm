"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { disconnectMailbox } from "@/lib/comms/connections";
import { encryptToken } from "@/lib/comms/token-crypto";
import { verifyTitanCredentials } from "@/lib/comms/providers/titan";

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
