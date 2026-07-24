import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { getQuickAddOptions, quickAddCompanySearch } from "../../src/app/(dashboard)/quick-add/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("getQuickAddOptions", () => {
  it("returns active lead types/pipeline stages and the default stage", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await createLeadTypeFixture("Pub");
    await testPrisma.leadType.create({ data: { name: "Inactive Type", active: false } });
    const stage = await createPipelineStageFixture("New", { isDefault: true, sortOrder: 0 });
    await testPrisma.pipelineStage.create({ data: { name: "Inactive Stage", active: false, sortOrder: 1 } });

    const options = await getQuickAddOptions();
    expect(options.currentUserId).toBe(user.id);
    expect(options.leadTypes.map((t) => t.name)).toEqual(["Pub"]);
    expect(options.pipelineStages.map((s) => s.name)).toEqual(["New"]);
    expect(options.defaultPipelineStageId).toBe(stage.id);
  });
});

describe("quickAddCompanySearch", () => {
  it("returns nothing below the minimum query length", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    expect(await quickAddCompanySearch("a")).toEqual([]);
  });

  it("respects companyScope — a Salesperson never sees another salesperson's company", async () => {
    const salesRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const salesperson = await createTestUser({ name: "Sales A", roleId: salesRole.id });
    const otherRole = await createRoleWithPermissions("OtherSales", ["view_assigned_leads"]);
    const other = await createTestUser({ name: "Sales B", roleId: otherRole.id });

    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({ name: "Mine Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: salesperson.id, createdById: salesperson.id });
    await createCompanyFixture({ name: "Not Mine Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: other.id, createdById: other.id });

    await loginAs(salesperson.id);
    const results = await quickAddCompanySearch("Bar");
    expect(results.map((c) => c.name)).toEqual(["Mine Bar"]);
  });

  it("excludes MERGED companies", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const survivor = await createCompanyFixture({ name: "Survivor Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    const merged = await createCompanyFixture({ name: "Merged Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await testPrisma.company.update({ where: { id: merged.id }, data: { status: "MERGED", mergedIntoId: survivor.id, mergedAt: new Date() } });

    const results = await quickAddCompanySearch("Bar");
    expect(results.map((c) => c.id)).toEqual([survivor.id]);
  });
});
