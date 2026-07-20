import { describe, it, expect } from "vitest";
import {
  reportScope,
  reportCompanyWhere,
  reportStageHistoryWhere,
  reportTaskWhere,
  reportUserWhere,
  canViewUserReport,
} from "../../src/lib/reports/scope";
import type { AuthenticatedUser } from "../../src/lib/auth/current-user";

function fakeUser(permissionKeys: string[], teamId: string | null = "team-1", id = "user-1"): AuthenticatedUser {
  return {
    id,
    teamId,
    role: {
      permissions: permissionKeys.map((key) => ({ allowed: true, permission: { key } })),
    },
  } as unknown as AuthenticatedUser;
}

describe("reportScope", () => {
  it("returns null with no report-view permission at all", () => {
    expect(reportScope(fakeUser(["view_all_leads", "edit_leads"]))).toBeNull();
  });

  it("view_all_reports gets the 'all' tier", () => {
    expect(reportScope(fakeUser(["view_all_reports"]))).toEqual({ tier: "all" });
  });

  it("view_team_reports gets the 'team' tier with the user's teamId", () => {
    expect(reportScope(fakeUser(["view_team_reports"], "team-9"))).toEqual({ tier: "team", teamId: "team-9" });
  });

  it("view_own_reports gets the 'own' tier with the user's id", () => {
    expect(reportScope(fakeUser(["view_own_reports"], "team-1", "user-42"))).toEqual({ tier: "own", userId: "user-42" });
  });

  it("prioritizes view_all_reports over narrower grants on the same role", () => {
    expect(reportScope(fakeUser(["view_all_reports", "view_team_reports", "view_own_reports"]))).toEqual({ tier: "all" });
  });

  it("is independent from lead-edit permissions — a report-only grant with no lead permissions still resolves", () => {
    expect(reportScope(fakeUser(["view_own_reports"]))).toEqual({ tier: "own", userId: "user-1" });
  });
});

describe("reportCompanyWhere", () => {
  it("'all' tier is unrestricted", () => {
    expect(reportCompanyWhere({ tier: "all" })).toEqual({});
  });

  it("'team' tier matches team-assigned OR unassigned companies", () => {
    expect(reportCompanyWhere({ tier: "team", teamId: "team-1" })).toEqual({
      OR: [{ assignedTo: { teamId: "team-1" } }, { assignedToId: null }],
    });
  });

  it("'own' tier matches only companies assigned to that user", () => {
    expect(reportCompanyWhere({ tier: "own", userId: "user-1" })).toEqual({ assignedToId: "user-1" });
  });
});

describe("reportStageHistoryWhere", () => {
  it("'all' tier is unrestricted", () => {
    expect(reportStageHistoryWhere({ tier: "all" })).toEqual({});
  });

  it("'team' tier scopes via the company relation, including unassigned", () => {
    expect(reportStageHistoryWhere({ tier: "team", teamId: "team-1" })).toEqual({
      company: { OR: [{ assignedTo: { teamId: "team-1" } }, { assignedToId: null }] },
    });
  });

  it("'own' tier scopes via the company relation to the user's assigned companies", () => {
    expect(reportStageHistoryWhere({ tier: "own", userId: "user-1" })).toEqual({ company: { assignedToId: "user-1" } });
  });
});

describe("reportTaskWhere", () => {
  it("'team' tier has no unassigned OR (Task.assignedToId is never null)", () => {
    expect(reportTaskWhere({ tier: "team", teamId: "team-1" })).toEqual({ assignedTo: { teamId: "team-1" } });
  });

  it("'own' tier matches only tasks assigned to that user", () => {
    expect(reportTaskWhere({ tier: "own", userId: "user-1" })).toEqual({ assignedToId: "user-1" });
  });
});

describe("reportUserWhere", () => {
  it("'all' tier includes every user", () => {
    expect(reportUserWhere({ tier: "all" })).toEqual({});
  });

  it("'team' tier includes only the user's team", () => {
    expect(reportUserWhere({ tier: "team", teamId: "team-1" })).toEqual({ teamId: "team-1" });
  });

  it("'team' tier with a null teamId matches no one, rather than accidentally matching every unassigned-team user", () => {
    expect(reportUserWhere({ tier: "team", teamId: null })).toEqual({ id: "__none__" });
  });

  it("'own' tier includes only that one user", () => {
    expect(reportUserWhere({ tier: "own", userId: "user-1" })).toEqual({ id: "user-1" });
  });
});

describe("canViewUserReport", () => {
  it("'all' tier can view any salesperson", () => {
    expect(canViewUserReport({ tier: "all" }, { id: "user-9", teamId: "team-9" })).toBe(true);
  });

  it("'team' tier can only view salespeople on the same team", () => {
    expect(canViewUserReport({ tier: "team", teamId: "team-1" }, { id: "user-9", teamId: "team-1" })).toBe(true);
    expect(canViewUserReport({ tier: "team", teamId: "team-1" }, { id: "user-9", teamId: "team-2" })).toBe(false);
  });

  it("'own' tier can only view themselves", () => {
    expect(canViewUserReport({ tier: "own", userId: "user-1" }, { id: "user-1", teamId: "team-1" })).toBe(true);
    expect(canViewUserReport({ tier: "own", userId: "user-1" }, { id: "user-2", teamId: "team-1" })).toBe(false);
  });
});
