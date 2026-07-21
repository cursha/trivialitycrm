import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { encryptToken, decryptToken } from "@/lib/comms/token-crypto";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { providerSlugFromKind } from "@/lib/comms/provider-kind";
import type { ConnectedAccount } from "@/lib/comms/providers/types";

// No `import "server-only"` — Phase A's doc comment here assumed the
// worker would resolve tokens through its own inline logic, but Phase C's
// scheduled-send and sequence-step worker handlers call sendEmail()
// (src/lib/comms/send-email.ts) directly, which calls getUsableAccessToken()
// below — confirmed by an actual worker crash during this phase's build
// testing ("This module cannot be imported from a Client Component
// module"), the same class of bug the Module Five server-only lesson
// documents. disconnectMailbox()/getConnectionStatus() remain web-only in
// practice (only ever called from the settings page), but there's no
// benefit to splitting them into a separate file just to keep a guard
// that costs nothing to drop.

/**
 * Revokes the connection with the provider on a best-effort basis (Google
 * supports a real revoke call; Microsoft Graph has no equivalent endpoint
 * for a third-party app — the user revokes via their own account settings)
 * and always deletes the local ProviderConnection row regardless of
 * whether the provider-side revoke succeeded. No reason to keep a dead,
 * encrypted-but-unusable token around — same "shortest safe retention"
 * principle Module Three already applied to import batches and sessions.
 */
export async function disconnectMailbox(userId: string): Promise<void> {
  const connection = await prisma.providerConnection.findUnique({ where: { userId } });
  if (!connection) return;

  if (connection.provider === "GOOGLE") {
    try {
      const accessToken = decryptToken(connection.encryptedAccessToken);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: "POST" });
    } catch (error) {
      // Best-effort — the local row is deleted regardless (see doc comment
      // above), so a failed revoke call here never leaves a connection
      // that still appears active to this app.
      logger.warn({ err: error, userId }, "Best-effort Google token revocation failed; disconnecting locally anyway.");
    }
  }

  await prisma.providerConnection.delete({ where: { userId } });
}

export type ConnectionStatusView = {
  provider: "microsoft" | "google";
  providerAccountEmail: string;
  status: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";
  connectedAt: Date;
  lastError: string | null;
};

/** Connection status only — never the encrypted tokens themselves. This is
 * the one place a page is allowed to read ProviderConnection for display. */
export async function getConnectionStatus(userId: string): Promise<ConnectionStatusView | null> {
  const connection = await prisma.providerConnection.findUnique({ where: { userId } });
  if (!connection) return null;
  return {
    provider: providerSlugFromKind(connection.provider),
    providerAccountEmail: connection.providerAccountEmail,
    status: connection.status,
    connectedAt: connection.connectedAt,
    lastError: connection.lastError,
  };
}

/**
 * Returns a usable (non-expired) access token for this user's connection,
 * refreshing and persisting a new one first if the stored token has
 * expired or is within 5 minutes of expiring. Marks the connection ERROR
 * (with lastError set) rather than throwing a raw provider error, so a
 * failed refresh surfaces as "reconnect your mailbox" in the UI instead of
 * an unhandled exception — callers (the send action) still get a thrown
 * error to stop the send, but the connection's own status row already
 * explains why.
 */
export async function getUsableAccessToken(userId: string): Promise<ConnectedAccount> {
  const connection = await prisma.providerConnection.findUniqueOrThrow({ where: { userId } });
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;

  if (connection.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS && connection.status === "CONNECTED") {
    return { accessToken: decryptToken(connection.encryptedAccessToken), refreshToken: decryptToken(connection.encryptedRefreshToken) };
  }

  const provider = getEmailProvider(providerSlugFromKind(connection.provider));
  try {
    const refreshed = await provider.refreshAccessToken(decryptToken(connection.encryptedRefreshToken));
    await prisma.providerConnection.update({
      where: { userId },
      data: {
        encryptedAccessToken: encryptToken(refreshed.accessToken),
        encryptedRefreshToken: encryptToken(refreshed.refreshToken),
        tokenExpiresAt: refreshed.expiresAt,
        status: "CONNECTED",
        lastError: null,
      },
    });
    return { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token refresh failed.";
    await prisma.providerConnection.update({ where: { userId }, data: { status: "ERROR", lastError: message } });
    throw new Error(`Your connected mailbox needs to be reconnected: ${message}`);
  }
}
