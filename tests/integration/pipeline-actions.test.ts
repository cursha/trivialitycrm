import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createTeam, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { changeCompanyStage, assignCompany } from "../../src/app/(dashboard)/companies/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const adminRole = await createRoleWithPermissions("Administrator", [
    "view_all_leads",
    "edit_leads",
    "reassign_leads",
  ]);
  const managerRole = await createRoleWithPermissions("Manager", ["view_team_leads", "edit_leads", "reassign_leads"]);
  const editOnlyRole = await createRoleWithPermissions("EditOnly", ["view_all_leads", "edit_leads"]);

  const admin = await createTestUser({ name: "Admin", roleId: adminRole.id });
  const leadType = await createLeadTypeFixture();
  const stageNew = await createPipelineStageFixture("New", { sortOrder: 0 });
  const stageDemo = await createPipelineStageFixture("Demo Given", { sortOrder: 1 });
  const inactiveStage = await createPipelineStageFixture("Retired", { sortOrder: 2 });
  await testPrisma.pipelineStage.update({ where: { id: inactiveStage.id }, data: { active: false } });

  return { adminRole, managerRole, editOnlyRole, admin, leadType, stageNew, stageDemo, inactiveStage };
}

describe("changeCompanyStage", () => {
  it("updates the stage and logs a PIPELINE_CHANGE activity", async () => {
    const { admin, leadType, stageNew, stageDemo } = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id, createdById: admin.id });

    await loginAs(admin.id);
    const result = await changeCompanyStage(company.id, stageDemo.id);

    expect(result).toEqual({ success: true });
    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.pipelineStageId).toBe(stageDemo.id);

    const activities = await testPrisma.activity.findMany({ where: { companyId: company.id, type: "PIPELINE_CHANGE" } });
    expect(activities).toHaveLength(1);
    expect(activities[0].notes).toContain("New");
    expect(activities[0].notes).toContain("Demo Given");
  });

  it("is a no-op (no activity) when the target stage is unchanged", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id, createdById: admin.id });

    await loginAs(admin.id);
    await changeCompanyStage(company.id, stageNew.id);

    expect(await testPrisma.activity.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("rejects moving into an inactive stage", async () => {
    const { admin, leadType, stageNew, inactiveStage } = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id, createdById: admin.id });

    await loginAs(admin.id);
    const result = await changeCompanyStage(company.id, inactiveStage.id);

    expect(result).toEqual({ error: "That pipeline stage is not available." });
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).pipelineStageId).toBe(stageNew.id);
  });

  it("denies a user without edit_leads", async () => {
    const { leadType, stageNew, stageDemo } = await baseFixtures();
    const viewerRole = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const viewer = await createTestUser({ roleId: viewerRole.id });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: viewer.id, createdById: viewer.id });

    await loginAs(viewer.id);
    await expect(changeCompanyStage(company.id, stageDemo.id)).rejects.toThrow(/Forbidden/);
  });

  it("denies a stage change on a company outside the caller's scope", async () => {
    const { leadType, stageNew, stageDemo } = await baseFixtures();
    const narrowRole = await createRoleWithPermissions("AssignedOnly", ["view_assigned_leads", "edit_leads"]);
    const editor = await createTestUser({ roleId: narrowRole.id });
    const owner = await createTestUser({ roleId: narrowRole.id });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: owner.id, createdById: owner.id });

    await loginAs(editor.id);
    const result = await changeCompanyStage(company.id, stageDemo.id);
    expect(result).toEqual({ error: "You do not have access to this company." });
  });
});

describe("assignCompany", () => {
  it("assigns a previously-unassigned company and logs ASSIGNMENT_CHANGE", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    const salesperson = await createTestUser({ name: "Sales One", roleId: admin.roleId });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id, createdById: admin.id });
    await testPrisma.company.update({ where: { id: company.id }, data: { assignedToId: null } });

    await loginAs(admin.id);
    const result = await assignCompany(company.id, salesperson.id);

    expect(result).toEqual({ success: true });
    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.assignedToId).toBe(salesperson.id);

    const activities = await testPrisma.activity.findMany({ where: { companyId: company.id, type: "ASSIGNMENT_CHANGE" } });
    expect(activities).toHaveLength(1);
    expect(activities[0].notes).toContain("Unassigned");
    expect(activities[0].notes).toContain("Sales One");
  });

  it("can unassign a company (set assignee to null)", async () => {
    const { admin, leadType, stageNew } = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: admin.id, createdById: admin.id });

    await loginAs(admin.id);
    const result = await assignCompany(company.id, null);

    expect(result).toEqual({ success: true });
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).assignedToId).toBeNull();
  });

  it("requires reassign_leads even for an edit_leads-only user", async () => {
    const { editOnlyRole, leadType, stageNew } = await baseFixtures();
    const editor = await createTestUser({ roleId: editOnlyRole.id });
    const target = await createTestUser({ roleId: editOnlyRole.id });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: editor.id, createdById: editor.id });

    await loginAs(editor.id);
    await expect(assignCompany(company.id, target.id)).rejects.toThrow(/Forbidden/);
  });

  it("blocks a Manager from assigning a company to someone on a different team", async () => {
    const { managerRole, leadType, stageNew } = await baseFixtures();
    const teamA = await createTeam("Team A");
    const teamB = await createTeam("Team B");
    const manager = await createTestUser({ roleId: managerRole.id, teamId: teamA.id });
    const outsideRep = await createTestUser({ roleId: managerRole.id, teamId: teamB.id });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: manager.id, createdById: manager.id });

    await loginAs(manager.id);
    const result = await assignCompany(company.id, outsideRep.id);

    expect(result).toEqual({ error: "You can only assign within your own team." });
  });

  it("allows a Manager to assign within their own team", async () => {
    const { managerRole, leadType, stageNew } = await baseFixtures();
    const team = await createTeam("Team A");
    const manager = await createTestUser({ roleId: managerRole.id, teamId: team.id });
    const teammate = await createTestUser({ roleId: managerRole.id, teamId: team.id });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: manager.id, createdById: manager.id });

    await loginAs(manager.id);
    const result = await assignCompany(company.id, teammate.id);

    expect(result).toEqual({ success: true });
  });
});
