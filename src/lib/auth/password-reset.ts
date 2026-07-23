import "server-only";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "./password";
import { invalidateAllSessionsForUser } from "./session";
import { writeAuditEvent } from "@/lib/audit/log";

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour — short, since delivery is a human relaying a link, not instant email.

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Anonymous, self-service entry point (/forgot-password). Always resolves
 * without revealing whether the email matched an account — the caller must
 * show the same generic message regardless. A no-op if the account is
 * disabled, or if an unresolved request for this user already exists (avoids
 * flooding the admin queue with duplicates from repeated submissions).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.disabled) {
    await writeAuditEvent({ actorId: null, module: "auth", action: "password_reset.requested", success: false, metadata: { email } });
    return;
  }

  const existing = await prisma.passwordResetRequest.findFirst({
    where: { userId: user.id, resolvedAt: null },
  });
  if (existing) {
    await writeAuditEvent({ actorId: null, module: "auth", action: "password_reset.requested", entityType: "User", entityId: user.id, metadata: { alreadyPending: true } });
    return;
  }

  await prisma.passwordResetRequest.create({ data: { userId: user.id } });
  await writeAuditEvent({ actorId: null, module: "auth", action: "password_reset.requested", entityType: "User", entityId: user.id });
}

export type PendingPasswordResetRequest = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  requestedAt: Date;
};

/** Admin-facing queue — /settings/users, gated by manage_users. */
export async function getPendingPasswordResetRequests(): Promise<PendingPasswordResetRequest[]> {
  const rows = await prisma.passwordResetRequest.findMany({
    where: { resolvedAt: null },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { requestedAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    userEmail: row.user.email,
    requestedAt: row.requestedAt,
  }));
}

export type GenerateResetLinkResult = { ok: true; token: string; expiresAt: Date } | { ok: false; error: string };

/**
 * Generates a fresh single-use token for the request's user and marks the
 * request resolved. Any previously unused token for this user is invalidated
 * first — only one active token at a time. The raw token is returned exactly
 * once here, to the calling admin action — after this call returns, only its
 * hash exists anywhere.
 */
export async function generatePasswordResetLink(requestId: string, adminId: string): Promise<GenerateResetLinkResult> {
  const request = await prisma.passwordResetRequest.findUnique({ where: { id: requestId } });
  if (!request || request.resolvedAt) {
    return { ok: false, error: "This request has already been handled." };
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: request.userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({
      data: { userId: request.userId, tokenHash: hashToken(rawToken), expiresAt, createdById: adminId },
    }),
    prisma.passwordResetRequest.update({
      where: { id: requestId },
      data: { resolvedAt: new Date(), resolvedById: adminId, resolution: "LINK_GENERATED" },
    }),
  ]);

  await writeAuditEvent({
    actorId: adminId,
    module: "auth",
    action: "password_reset.link_generated",
    entityType: "User",
    entityId: request.userId,
    metadata: { expiresAt: expiresAt.toISOString() },
  });

  return { ok: true, token: rawToken, expiresAt };
}

export async function dismissPasswordResetRequest(requestId: string, adminId: string): Promise<void> {
  const request = await prisma.passwordResetRequest.findUnique({ where: { id: requestId } });
  if (!request || request.resolvedAt) return;

  await prisma.passwordResetRequest.update({
    where: { id: requestId },
    data: { resolvedAt: new Date(), resolvedById: adminId, resolution: "DISMISSED" },
  });

  await writeAuditEvent({ actorId: adminId, module: "auth", action: "password_reset.dismissed", entityType: "User", entityId: request.userId });
}

export type CompleteResetResult = { ok: true } | { ok: false; error: string };

const INVALID_TOKEN_ERROR = "This reset link is invalid or has expired. Ask an administrator for a new one.";

/**
 * Verifies the token and sets a new password chosen by the user themselves
 * — unlike an admin-set temporary password, mustChangePassword is cleared,
 * matching change-password's own end state. Invalidates every existing
 * session (a reset should kill any session an attacker might hold) and
 * clears lockout state.
 */
export async function completePasswordReset(rawToken: string, newPassword: string): Promise<CompleteResetResult> {
  const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });

  if (!token || token.usedAt || token.expiresAt < new Date()) {
    return { ok: false, error: INVALID_TOKEN_ERROR };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: { passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
  ]);

  await invalidateAllSessionsForUser(token.userId);
  await writeAuditEvent({ actorId: null, module: "auth", action: "password_reset.completed", entityType: "User", entityId: token.userId });

  return { ok: true };
}
