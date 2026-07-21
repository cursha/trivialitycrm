// No `import "server-only"` — the worker (worker/handlers/generate-report.ts,
// via the report-scope chain) needs hasPermission()/requirePermission() too,
// and that guard throws under plain Node/tsx execution. Every consumer is
// itself a server-only context (web Server Actions/pages, or the worker
// process). Same reasoning as src/lib/prisma.ts's identical omission.
import type { CurrentUser } from "./current-user";

export class ForbiddenError extends Error {
  constructor(permissionKey: string) {
    super(`Forbidden: missing permission "${permissionKey}"`);
    this.name = "ForbiddenError";
  }
}

export function hasPermission(user: CurrentUser, permissionKey: string): boolean {
  if (!user) return false;
  return user.role.permissions.some((rp) => rp.allowed && rp.permission.key === permissionKey);
}

/**
 * Server-side enforcement for a query or mutation. Throws rather than
 * returning a boolean so a missing call site fails loudly instead of
 * silently proceeding. Row-level scope (e.g. a Salesperson's "assigned"
 * leads, a Manager's team) is NOT handled here — that's enforced per query
 * by filtering on assignedToId/teamId alongside this permission check.
 */
export function requirePermission(user: CurrentUser, permissionKey: string): void {
  if (!hasPermission(user, permissionKey)) {
    throw new ForbiddenError(permissionKey);
  }
}
