import "server-only";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import type { Prisma } from "../../generated/prisma/client";

/**
 * Report visibility is a separate permission tier from lead-edit visibility
 * (see src/lib/companies/scope.ts's companyScope) — a Salesperson who can
 * only edit their own assigned leads still might, in principle, be granted
 * view_team_reports by an Administrator, and vice versa. Every report query
 * must call this (not companyScope) to decide what it may aggregate over.
 */
export type ReportScope = { tier: "all" } | { tier: "team"; teamId: string | null } | { tier: "own"; userId: string };

/** Returns null if the user has no report-view permission at all — callers
 * must treat that as "deny", not as "no filter". */
export function reportScope(user: AuthenticatedUser): ReportScope | null {
  if (hasPermission(user, "view_all_reports")) return { tier: "all" };
  if (hasPermission(user, "view_team_reports")) return { tier: "team", teamId: user.teamId };
  if (hasPermission(user, "view_own_reports")) return { tier: "own", userId: user.id };
  return null;
}

/** Same nullable-assignedToId reasoning as companyScope: a relation filter
 * can never match a company with no assignee, so "team" scope explicitly
 * ORs in the unassigned pool rather than hiding it from Managers. */
export function reportCompanyWhere(scope: ReportScope): Prisma.CompanyWhereInput {
  switch (scope.tier) {
    case "all":
      return {};
    case "team":
      return { OR: [{ assignedTo: { teamId: scope.teamId } }, { assignedToId: null }] };
    case "own":
      return { assignedToId: scope.userId };
  }
}

/** Which PipelineStageHistory rows this scope may aggregate over — scoped
 * by the company the change happened on, not by who made the change, so a
 * Manager sees every stage transition on their team's companies even if a
 * different team's member (e.g. a prior owner) recorded it. */
export function reportStageHistoryWhere(scope: ReportScope): Prisma.PipelineStageHistoryWhereInput {
  switch (scope.tier) {
    case "all":
      return {};
    case "team":
      return { company: { OR: [{ assignedTo: { teamId: scope.teamId } }, { assignedToId: null }] } };
    case "own":
      return { company: { assignedToId: scope.userId } };
  }
}

/** Same scoping rule as reportCompanyWhere, applied to Task.assignedToId —
 * every Task has a required assignee, so (unlike companies) there is no
 * unassigned-pool case to OR in. */
export function reportTaskWhere(scope: ReportScope): Prisma.TaskWhereInput {
  switch (scope.tier) {
    case "all":
      return {};
    case "team":
      return { assignedTo: { teamId: scope.teamId } };
    case "own":
      return { assignedToId: scope.userId };
  }
}

/** Which User rows a salesperson-performance report may include. */
export function reportUserWhere(scope: ReportScope): Prisma.UserWhereInput {
  switch (scope.tier) {
    case "all":
      return {};
    case "team":
      return scope.teamId ? { teamId: scope.teamId } : { id: "__none__" };
    case "own":
      return { id: scope.userId };
  }
}

/** Whether `scope` permits viewing a specific salesperson's individual
 * report page (as opposed to an aggregate report) — used by
 * /reports/salespeople/[userId] to reject direct-navigation attempts
 * outside the viewer's scope. */
export function canViewUserReport(scope: ReportScope, target: { id: string; teamId: string | null }): boolean {
  switch (scope.tier) {
    case "all":
      return true;
    case "team":
      return target.teamId === scope.teamId;
    case "own":
      return target.id === scope.userId;
  }
}
