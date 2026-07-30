import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createTeam, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import {
  createSalesList,
  updateSalesList,
  duplicateSalesList,
  archiveSalesList,
  restoreSalesList,
  deleteSalesList,
  addCompaniesToList,
  removeCompanyFromList,
  refreshDynamicList,
} from "../../src/app/(dashboard)/sales-lists/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures(permissions: string[] = ["view_sales_lists", "create_sales_lists", "manage_own_sales_lists", "view_all_leads"]) {
  const role = await createRoleWithPermissions("SalesListUser", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  return { user, leadType, stage };
}

describe("Sales List CRUD", () => {
  it("creates a fixed list with initial members, scoped to companies the creator can access", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });

    const result = await createSalesList({
      name: "My Fixed List",
      purpose: "GENERAL_SALES",
      type: "FIXED",
      visibility: "PRIVATE",
      companyIds: [company.id],
    });
    expect(result).toHaveProperty("success", true);

    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "My Fixed List" }, include: { members: true } });
    expect(list.ownerId).toBe(user.id);
    expect(list.members).toHaveLength(1);
    expect(list.members[0].companyId).toBe(company.id);
  });

  it("creates a dynamic list with validated filters", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    const result = await createSalesList({
      name: "Ontario Prospects",
      purpose: "CALLING",
      type: "DYNAMIC",
      visibility: "PRIVATE",
      filters: { region: "ON", hasPhone: true },
    });
    expect(result).toHaveProperty("success", true);

    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Ontario Prospects" } });
    expect(list.type).toBe("DYNAMIC");
    expect(list.filters).toEqual({ region: "ON", hasPhone: true });
  });

  it("rejects an invalid filter shape for a dynamic list", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    const result = await createSalesList({
      name: "Bad List",
      purpose: "CALLING",
      type: "DYNAMIC",
      visibility: "PRIVATE",
      filters: { notARealField: "1=1" },
    });
    expect(result).toHaveProperty("error");
  });

  it("shares a list with the entire team, visible to a teammate but not an outsider", async () => {
    const team = await createTeam();
    const role = await createRoleWithPermissions("TeamUser", ["view_sales_lists", "create_sales_lists"]);
    const owner = await createTestUser({ roleId: role.id, teamId: team.id });
    const teammate = await createTestUser({ roleId: role.id, teamId: team.id });
    const outsider = await createTestUser({ roleId: role.id, teamId: null });

    await loginAs(owner.id);
    await createSalesList({ name: "Team List", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "SHARED_TEAM", filters: {} });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Team List" } });

    const { salesListVisibilityWhere } = await import("../../src/lib/sales-lists/scope");
    const { getCurrentUser } = await import("../../src/lib/auth/current-user");

    await loginAs(teammate.id);
    const teammateUser = await getCurrentUser();
    const visibleToTeammate = await testPrisma.salesList.findFirst({ where: { id: list.id, ...salesListVisibilityWhere(teammateUser!) } });
    expect(visibleToTeammate).not.toBeNull();

    await loginAs(outsider.id);
    const outsiderUser = await getCurrentUser();
    const visibleToOutsider = await testPrisma.salesList.findFirst({ where: { id: list.id, ...salesListVisibilityWhere(outsiderUser!) } });
    expect(visibleToOutsider).toBeNull();
  });

  it("shares a list with specific users only", async () => {
    const role = await createRoleWithPermissions("Sharer", ["view_sales_lists", "create_sales_lists"]);
    const owner = await createTestUser({ roleId: role.id });
    const grantee = await createTestUser({ roleId: role.id });
    const stranger = await createTestUser({ roleId: role.id });

    await loginAs(owner.id);
    await createSalesList({
      name: "Shared With Some",
      purpose: "GENERAL_SALES",
      type: "DYNAMIC",
      visibility: "SHARED_USERS",
      filters: {},
      sharedUserIds: [grantee.id],
    });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Shared With Some" } });

    const { salesListVisibilityWhere } = await import("../../src/lib/sales-lists/scope");
    const { getCurrentUser } = await import("../../src/lib/auth/current-user");

    await loginAs(grantee.id);
    const granteeUser = await getCurrentUser();
    expect(await testPrisma.salesList.findFirst({ where: { id: list.id, ...salesListVisibilityWhere(granteeUser!) } })).not.toBeNull();

    await loginAs(stranger.id);
    const strangerUser = await getCurrentUser();
    expect(await testPrisma.salesList.findFirst({ where: { id: list.id, ...salesListVisibilityWhere(strangerUser!) } })).toBeNull();
  });

  it("only the creator or an administrator may edit a list — a shared user cannot", async () => {
    const role = await createRoleWithPermissions("Sharer2", ["view_sales_lists", "create_sales_lists", "manage_own_sales_lists"]);
    const owner = await createTestUser({ roleId: role.id });
    const grantee = await createTestUser({ roleId: role.id });

    await loginAs(owner.id);
    await createSalesList({
      name: "Owner Only Edit",
      purpose: "GENERAL_SALES",
      type: "DYNAMIC",
      visibility: "SHARED_USERS",
      filters: {},
      sharedUserIds: [grantee.id],
    });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Owner Only Edit" } });

    await loginAs(grantee.id);
    const result = await updateSalesList(list.id, { name: "Hijacked" });
    expect(result).toHaveProperty("error");

    await loginAs(owner.id);
    const ownerResult = await updateSalesList(list.id, { name: "Renamed By Owner" });
    expect(ownerResult).toHaveProperty("success", true);
  });

  it("an administrator (manage_all_sales_lists) may edit any list", async () => {
    const ownerRole = await createRoleWithPermissions("Owner3", ["view_sales_lists", "create_sales_lists"]);
    const owner = await createTestUser({ roleId: ownerRole.id });
    const adminRole = await createRoleWithPermissions("Admin3", ["view_sales_lists", "manage_all_sales_lists"]);
    const admin = await createTestUser({ roleId: adminRole.id });

    await loginAs(owner.id);
    await createSalesList({ name: "Admin Editable", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: {} });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Admin Editable" } });

    await loginAs(admin.id);
    const result = await updateSalesList(list.id, { name: "Renamed By Admin" });
    expect(result).toHaveProperty("success", true);
  });

  it("adds selected companies to a fixed list and can remove one", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const companyA = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    const companyB = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });

    await createSalesList({ name: "Add/Remove List", purpose: "GENERAL_SALES", type: "FIXED", visibility: "PRIVATE" });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Add/Remove List" } });

    await addCompaniesToList(list.id, [companyA.id, companyB.id]);
    expect(await testPrisma.salesListMember.count({ where: { listId: list.id } })).toBe(2);

    await removeCompanyFromList(list.id, companyA.id);
    const remaining = await testPrisma.salesListMember.findMany({ where: { listId: list.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].companyId).toBe(companyB.id);
  });

  it("does not add a company outside the caller's own scope", async () => {
    const role = await createRoleWithPermissions("Narrow", ["view_sales_lists", "create_sales_lists", "manage_own_sales_lists", "view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const otherOwnerRole = await createRoleWithPermissions("OtherOwner", ["add_leads"]);
    const otherOwner = await createTestUser({ roleId: otherOwnerRole.id });
    const outOfScopeCompany = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: otherOwner.id, createdById: otherOwner.id });

    await loginAs(user.id);
    await createSalesList({ name: "Scoped List", purpose: "GENERAL_SALES", type: "FIXED", visibility: "PRIVATE" });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Scoped List" } });

    const result = await addCompaniesToList(list.id, [outOfScopeCompany.id]);
    expect(result).toHaveProperty("error");
    expect(await testPrisma.salesListMember.count({ where: { listId: list.id } })).toBe(0);
  });

  it("refreshes a dynamic list, caching matches and reporting newly-eligible/no-longer-matching", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const matching = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id, city: "Milton" });
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id, city: "Toronto" });

    await createSalesList({ name: "Milton Only", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: { city: "Milton" } });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Milton Only" } });

    const first = await refreshDynamicList(list.id);
    expect(first).toMatchObject({ success: true, total: 1, newlyEligible: 1, noLongerMatching: 0 });

    const cached = await testPrisma.salesListDynamicMember.findMany({ where: { listId: list.id } });
    expect(cached.map((c) => c.companyId)).toEqual([matching.id]);

    const refreshedList = await testPrisma.salesList.findUniqueOrThrow({ where: { id: list.id } });
    expect(refreshedList.lastEvaluatedAt).not.toBeNull();

    // Second refresh with nothing changed should report zero deltas.
    const second = await refreshDynamicList(list.id);
    expect(second).toMatchObject({ success: true, total: 1, newlyEligible: 0, noLongerMatching: 0 });
  });

  it("duplicates a list as a new private copy, leaving the original untouched", async () => {
    const { user, leadType, stage } = await baseFixtures();
    const team = await createTeam();
    await testPrisma.user.update({ where: { id: user.id }, data: { teamId: team.id } });
    await loginAs(user.id);
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await createSalesList({ name: "Source List", purpose: "GENERAL_SALES", type: "FIXED", visibility: "SHARED_TEAM", companyIds: [company.id] });
    const source = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Source List" } });

    const result = await duplicateSalesList(source.id);
    expect(result).toHaveProperty("success", true);

    const copy = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Source List (copy)" }, include: { members: true } });
    expect(copy.visibility).toBe("PRIVATE");
    expect(copy.members).toHaveLength(1);

    const original = await testPrisma.salesList.findUniqueOrThrow({ where: { id: source.id } });
    expect(original.visibility).toBe("SHARED_TEAM");
  });

  it("archives and restores a list", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);
    await createSalesList({ name: "Archive Me", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: {} });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Archive Me" } });

    await archiveSalesList(list.id);
    expect((await testPrisma.salesList.findUniqueOrThrow({ where: { id: list.id } })).archivedAt).not.toBeNull();

    await restoreSalesList(list.id);
    expect((await testPrisma.salesList.findUniqueOrThrow({ where: { id: list.id } })).archivedAt).toBeNull();
  });

  it("refuses to delete a list that isn't archived, even for an administrator", async () => {
    const ownerRole = await createRoleWithPermissions("Owner4", ["view_sales_lists", "create_sales_lists"]);
    const owner = await createTestUser({ roleId: ownerRole.id });
    const adminRole = await createRoleWithPermissions("Admin4", ["manage_all_sales_lists"]);
    const admin = await createTestUser({ roleId: adminRole.id });

    await loginAs(owner.id);
    await createSalesList({ name: "Not Archived", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: {} });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "Not Archived" } });

    await loginAs(admin.id);
    const result = await deleteSalesList(list.id);
    expect(result).toHaveProperty("error");
    expect(await testPrisma.salesList.findUnique({ where: { id: list.id } })).not.toBeNull();
  });

  it("permanently deletes an already-archived list for an administrator", async () => {
    const ownerRole = await createRoleWithPermissions("Owner5", ["view_sales_lists", "create_sales_lists", "manage_own_sales_lists"]);
    const owner = await createTestUser({ roleId: ownerRole.id });
    const adminRole = await createRoleWithPermissions("Admin5", ["manage_all_sales_lists"]);
    const admin = await createTestUser({ roleId: adminRole.id });

    await loginAs(owner.id);
    await createSalesList({ name: "To Delete", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: {} });
    const list = await testPrisma.salesList.findFirstOrThrow({ where: { name: "To Delete" } });
    await archiveSalesList(list.id);

    await loginAs(admin.id);
    const result = await deleteSalesList(list.id);
    expect(result).toHaveProperty("success", true);
    expect(await testPrisma.salesList.findUnique({ where: { id: list.id } })).toBeNull();
  });

  it("rejects list creation from a user without create_sales_lists", async () => {
    const role = await createRoleWithPermissions("NoCreate", ["view_sales_lists"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createSalesList({ name: "Should Fail", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: {} })).rejects.toThrow();
  });
});
