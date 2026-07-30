import "server-only";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import type { Prisma } from "../../generated/prisma/client";

/**
 * The WHERE clause restricting SalesLists to what this user may see: their
 * own, any SHARED_TEAM list owned by someone on their team, or any
 * SHARED_USERS list they've been explicitly granted via SalesListShare —
 * mirroring companyScope()'s own/team/all shape but keyed on the 3-tier
 * SalesListVisibility enum instead. `manage_all_sales_lists` (Administrator
 * by default) sees every list, matching every other manage_all_*-style
 * override elsewhere in this app. Returns null if the user lacks even
 * view_sales_lists — callers must treat that as "deny", not "no filter".
 */
export function salesListVisibilityWhere(user: AuthenticatedUser): Prisma.SalesListWhereInput | null {
  if (!hasPermission(user, "view_sales_lists")) return null;
  if (hasPermission(user, "manage_all_sales_lists")) return {};
  return {
    OR: [
      { ownerId: user.id },
      { visibility: "SHARED_TEAM", owner: { teamId: user.teamId } },
      { visibility: "SHARED_USERS", shares: { some: { userId: user.id } } },
    ],
  };
}

/**
 * Whether `user` may change this list's definition (rename/edit filters or
 * membership/visibility) or delete it — visibility governs who can SEE/USE
 * a list, this governs who can CHANGE it. Only the creator (and only while
 * they still hold manage_own_sales_lists — a role change after list
 * creation must actually take effect) or an Administrator-equivalent
 * (manage_all_sales_lists) ever may, per the spec: "Only the creator and
 * administrators may change or delete the list."
 */
export function canManageSalesList(user: AuthenticatedUser, list: { ownerId: string }): boolean {
  if (hasPermission(user, "manage_all_sales_lists")) return true;
  return list.ownerId === user.id && hasPermission(user, "manage_own_sales_lists");
}
