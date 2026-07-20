import { describe, it, expect } from "vitest";
import { companyScope, taskScope } from "../../src/lib/companies/scope";
import type { AuthenticatedUser } from "../../src/lib/auth/current-user";

function fakeUser(permissionKeys: string[], teamId: string | null = "team-1"): AuthenticatedUser {
  return {
    teamId,
    role: {
      permissions: permissionKeys.map((key) => ({ allowed: true, permission: { key } })),
    },
  } as unknown as AuthenticatedUser;
}

describe("companyScope", () => {
  it("view_all_leads gets an unrestricted filter", () => {
    expect(companyScope(fakeUser(["view_all_leads"]))).toEqual({});
  });

  it("view_team_leads matches team-assigned companies OR unassigned companies", () => {
    // Regression test: assignedTo is a relation filter, which can never
    // match a company whose assignedToId is null (no related row to check
    // teamId against) — without the explicit OR, unassigned companies were
    // invisible to every Manager, breaking the Unassigned Leads view.
    const scope = companyScope(fakeUser(["view_team_leads"], "team-1"));
    expect(scope).toEqual({ OR: [{ assignedTo: { teamId: "team-1" } }, { assignedToId: null }] });
  });

  it("view_assigned_leads only matches companies assigned to that exact user", () => {
    const user = fakeUser(["view_assigned_leads"]);
    (user as { id: string }).id = "user-1";
    expect(companyScope(user)).toEqual({ assignedToId: "user-1" });
  });

  it("returns null with no lead-view permission at all", () => {
    expect(companyScope(fakeUser(["edit_leads"]))).toBeNull();
  });

  it("prioritizes view_all_leads over a narrower grant on the same role", () => {
    expect(companyScope(fakeUser(["view_all_leads", "view_team_leads", "view_assigned_leads"]))).toEqual({});
  });
});

describe("taskScope", () => {
  it("view_team_leads matches tasks assigned to the user's team (Task.assignedToId stays non-nullable, no OR needed)", () => {
    expect(taskScope(fakeUser(["view_team_leads"], "team-1"))).toEqual({ assignedTo: { teamId: "team-1" } });
  });
});
