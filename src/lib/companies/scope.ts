import "server-only";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import type { Prisma } from "../../generated/prisma/client";

/**
 * The WHERE clause restricting companies to what this user may view/edit,
 * based on their broadest view_* permission (Administrator: all, Manager:
 * their team, Salesperson: assigned to them). Returns null if the user has
 * no lead-view permission at all — callers must treat that as "deny", not
 * as "no filter".
 */
export function companyScope(user: AuthenticatedUser): Prisma.CompanyWhereInput | null {
  if (hasPermission(user, "view_all_leads")) return {};
  if (hasPermission(user, "view_team_leads")) {
    // `assignedTo: { teamId }` is a relation filter — it can never match a
    // company with a null assignedToId (no related User row to check
    // against), so unassigned companies would otherwise be invisible to
    // every Manager. OR in "unassigned" explicitly so a Manager can see and
    // triage the unassigned pool, matching Module Four's "show unassigned
    // leads clearly" requirement.
    return { OR: [{ assignedTo: { teamId: user.teamId } }, { assignedToId: null }] };
  }
  if (hasPermission(user, "view_assigned_leads")) return { assignedToId: user.id };
  return null;
}

/** Same scoping rule as companyScope, applied to Task.assignedToId instead
 * of Company.assignedToId — a follow-up task carries its own assignee. */
export function taskScope(user: AuthenticatedUser): Prisma.TaskWhereInput | null {
  if (hasPermission(user, "view_all_leads")) return {};
  if (hasPermission(user, "view_team_leads")) {
    return { assignedTo: { teamId: user.teamId } };
  }
  if (hasPermission(user, "view_assigned_leads")) return { assignedToId: user.id };
  return null;
}

/**
 * Whether `user` may assign/reassign a company to `targetUserId` (or
 * unassign it, when `targetUserId` is null). Factored out of the single
 * inline check `updateCompany` used to have, so the pipeline board's
 * drag-and-drop assignment, single reassignment, and bulk reassignment all
 * enforce the exact same team boundary instead of three separate copies.
 * Callers must still call `requirePermission(user, "reassign_leads")`
 * themselves before this — this function only answers the *team-boundary*
 * question, not whether the user may reassign at all.
 */
export async function canAssignTo(
  client: Prisma.TransactionClient,
  user: AuthenticatedUser,
  targetUserId: string | null,
): Promise<boolean> {
  if (targetUserId === null) return true;
  if (hasPermission(user, "view_all_leads")) return true;
  const target = await client.user.findUnique({ where: { id: targetUserId } });
  return !!target && target.teamId === user.teamId;
}
