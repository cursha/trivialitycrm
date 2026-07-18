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
    return { assignedTo: { teamId: user.teamId } };
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
