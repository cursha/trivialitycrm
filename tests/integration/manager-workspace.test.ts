import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createTeam, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { getCurrentUser } from "../../src/lib/auth/current-user";
import { getManagerWorkspaceData } from "../../src/app/(dashboard)/manager/queries";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("getManagerWorkspaceData scoping", () => {
  it("a Manager sees their own team's assigned companies but not another team's assigned companies", async () => {
    const managerRole = await createRoleWithPermissions("Manager", ["view_team_leads", "view_manager_workspace"]);
    const teamA = await createTeam("Team A");
    const teamB = await createTeam("Team B");
    const manager = await createTestUser({ roleId: managerRole.id, teamId: teamA.id });
    const repOnTeamA = await createTestUser({ roleId: managerRole.id, teamId: teamA.id });
    const repOnTeamB = await createTestUser({ roleId: managerRole.id, teamId: teamB.id });

    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();

    await createCompanyFixture({ name: "Team A lead", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: repOnTeamA.id, createdById: manager.id });
    await createCompanyFixture({ name: "Team B lead", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: repOnTeamB.id, createdById: manager.id });

    await loginAs(manager.id);
    const authedUser = await getCurrentUser();
    const data = await getManagerWorkspaceData(authedUser!);

    expect(data).not.toBeNull();
    // Only Team A's company counts toward this Manager's active-lead total.
    expect(data!.stats.activeLeads).toBe(1);
  });

  it("unassigned companies are visible to any team-scoped Manager, not restricted to one team", async () => {
    // Unassigned means "belongs to no team yet" — every Manager needs to be
    // able to see and triage the unassigned pool, so this is intentionally
    // NOT team-isolated (see the companyScope() fix in scope.ts: a company
    // with a null assignedToId has no related User row to check teamId
    // against, so it must be explicitly OR'd in rather than relying on the
    // relation filter).
    const managerRole = await createRoleWithPermissions("Manager", ["view_team_leads", "view_manager_workspace"]);
    const teamA = await createTeam("Team A");
    const teamB = await createTeam("Team B");
    const managerA = await createTestUser({ roleId: managerRole.id, teamId: teamA.id });
    const managerB = await createTestUser({ roleId: managerRole.id, teamId: teamB.id });

    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    await createCompanyFixture({ name: "Nobody's lead", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: managerA.id, createdById: managerA.id });
    await testPrisma.company.updateMany({ where: { name: "Nobody's lead" }, data: { assignedToId: null } });

    await loginAs(managerA.id);
    const dataA = await getManagerWorkspaceData((await getCurrentUser())!);
    expect(dataA!.unassignedCount).toBe(1);

    resetFakeCookies();
    await loginAs(managerB.id);
    const dataB = await getManagerWorkspaceData((await getCurrentUser())!);
    expect(dataB!.unassignedCount).toBe(1);
  });

  it("an Administrator (view_all_leads) sees every team's data", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["view_all_leads", "view_manager_workspace"]);
    const managerRole = await createRoleWithPermissions("Manager", ["view_team_leads"]);
    const admin = await createTestUser({ name: "Admin", roleId: adminRole.id });
    const teamA = await createTeam("Team A");
    const teamB = await createTeam("Team B");
    const repA = await createTestUser({ roleId: managerRole.id, teamId: teamA.id });
    const repB = await createTestUser({ roleId: managerRole.id, teamId: teamB.id });

    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    await createCompanyFixture({ name: "A", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: repA.id, createdById: admin.id });
    await testPrisma.company.updateMany({ where: { name: "A" }, data: { assignedToId: null } });
    await createCompanyFixture({ name: "B", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: repB.id, createdById: admin.id });
    await testPrisma.company.updateMany({ where: { name: "B" }, data: { assignedToId: null } });

    await loginAs(admin.id);
    const authedUser = await getCurrentUser();
    const data = await getManagerWorkspaceData(authedUser!);

    expect(data!.unassignedCount).toBe(2);
  });

  it("returns null for a user with no lead-view permission at all", async () => {
    const noAccessRole = await createRoleWithPermissions("NoAccess", ["view_manager_workspace"]);
    const user = await createTestUser({ roleId: noAccessRole.id });

    await loginAs(user.id);
    const authedUser = await getCurrentUser();
    const data = await getManagerWorkspaceData(authedUser!);

    expect(data).toBeNull();
  });
});
