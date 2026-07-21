// No `import "server-only"` — worker/handlers/generate-report.ts needs
// getUserById() too, and that guard throws under plain Node/tsx execution.
// Every consumer is itself a server-only context (web Server
// Components/Actions, or the worker process). Same reasoning as
// src/lib/prisma.ts's identical omission.
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUserId } from "./session";

// Memoized per request/render pass so multiple components/actions calling
// getCurrentUser() during the same request share one DB round trip.
const loadCurrentUser = cache(async () => {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      team: true,
    },
  });

  // Defense in depth: disabling a user also deletes their sessions (see
  // src/lib/auth/session.ts's invalidateAllSessionsForUser), so this branch
  // should be unreachable in normal operation.
  if (!user || user.disabled) return null;

  return user;
});

export type CurrentUser = Awaited<ReturnType<typeof loadCurrentUser>>;
export type AuthenticatedUser = NonNullable<CurrentUser>;

export async function getCurrentUser(): Promise<CurrentUser> {
  return loadCurrentUser();
}

/**
 * Same include shape as the session-based lookup above, for callers with no
 * request/session context at all — the worker process, which runs a
 * scheduled report as its creator's own report scope. Not cached (no
 * per-request lifetime to memoize against) and does not check `disabled`
 * itself; callers that need that guarantee should check it explicitly.
 */
export async function getUserById(userId: string): Promise<AuthenticatedUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      team: true,
    },
  });
}

/**
 * The single server-side enforcement point ~119 call sites (server actions,
 * route handlers, page renders) rely on for "is there a valid session".
 * Also enforces the forced-password-change flag here — previously this was
 * only checked at the login redirect, so a user with an already-valid
 * session cookie could reach any protected route/action directly (e.g. by
 * bookmarking a URL) without ever completing the required change. Every
 * call site gets this for free; the only two call sites that must be
 * allowed to proceed *with* mustChangePassword still set (the change-
 * password page itself, and its submit action) opt out explicitly via
 * `allowMustChangePassword`, so the redirect can't loop against itself.
 */
export async function requireUser(options: { allowMustChangePassword?: boolean } = {}): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.mustChangePassword && !options.allowMustChangePassword) {
    redirect("/change-password");
  }
  return user;
}
