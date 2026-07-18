import "server-only";
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

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
