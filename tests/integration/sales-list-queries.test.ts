import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { getCurrentUser } from "../../src/lib/auth/current-user";
import { previewListCompanies, selectAllMatchingCompanyIds, getListCompanies, getListEligibilitySummary, getSalesListById } from "../../src/lib/sales-lists/queries";
import { createSalesList, addCompaniesToList, refreshDynamicList } from "../../src/app/(dashboard)/sales-lists/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures(permissions: string[] = ["view_sales_lists", "create_sales_lists", "manage_own_sales_lists", "view_all_leads"]) {
  const role = await createRoleWithPermissions("QueryUser", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  return { user, leadType, stage };
}

describe("previewListCompanies", () => {
  it("returns only companies matching the given filters, scoped to the caller", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    await createCompanyFixture({ name: "In Milton", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id, city: "Milton" });
    await createCompanyFixture({ name: "In Toronto", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id, city: "Toronto" });

    const currentUser = await getCurrentUser();
    const result = await previewListCompanies(currentUser!, { city: "Milton" }, {});
    expect(result?.companies.map((c) => c.name)).toEqual(["In Milton"]);
  });
});

describe("selectAllMatchingCompanyIds", () => {
  it("returns every matching id, not just one page", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const created = await Promise.all(
      Array.from({ length: 3 }, (_, i) => createCompanyFixture({ name: `Co ${i}`, leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id })),
    );

    const currentUser = await getCurrentUser();
    const { ids, truncated } = await selectAllMatchingCompanyIds(currentUser!, {});
    expect(ids.sort()).toEqual(created.map((c) => c.id).sort());
    expect(truncated).toBe(false);
  });
});

describe("getListCompanies", () => {
  it("returns a fixed list's explicit members, re-scoped to the viewer", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const included = await createCompanyFixture({ name: "Included", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await createCompanyFixture({ name: "Not Included", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });

    const created = await createSalesList({ name: "Fixed Test", purpose: "GENERAL_SALES", type: "FIXED", visibility: "PRIVATE", companyIds: [included.id] });
    if (!("success" in created)) throw new Error("failed");
    const list = await testPrisma.salesList.findUniqueOrThrow({ where: { id: created.id } });

    const currentUser = await getCurrentUser();
    const result = await getListCompanies(currentUser!, list, {});
    expect(result?.companies.map((c) => c.name)).toEqual(["Included"]);
  });

  it("returns a dynamic list's cached (refreshed) members, not a live re-query", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    await createCompanyFixture({ name: "Matches", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id, city: "Milton" });

    const created = await createSalesList({ name: "Dynamic Test", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: { city: "Milton" } });
    if (!("success" in created)) throw new Error("failed");
    const currentUser = await getCurrentUser();

    // Before any refresh, the cache is empty — the list page must not
    // silently fall back to a live query (see refreshDynamicList's doc
    // comment on "cached, not live" downloads/displays).
    let list = await testPrisma.salesList.findUniqueOrThrow({ where: { id: created.id } });
    let result = await getListCompanies(currentUser!, list, {});
    expect(result?.companies).toHaveLength(0);

    await refreshDynamicList(created.id);
    list = await testPrisma.salesList.findUniqueOrThrow({ where: { id: created.id } });
    result = await getListCompanies(currentUser!, list, {});
    expect(result?.companies.map((c) => c.name)).toEqual(["Matches"]);
  });
});

describe("getListEligibilitySummary", () => {
  it("counts eligible/ineligible across the whole list, not just one page, for a CALLING list", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const withPhone = await createCompanyFixture({ name: "Has Phone", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    const noPhone = await createCompanyFixture({ name: "No Phone", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await testPrisma.company.update({ where: { id: withPhone.id }, data: { phone: "555-0100" } });
    await testPrisma.company.update({ where: { id: noPhone.id }, data: { phone: null } });

    const created = await createSalesList({ name: "Calling Eligibility", purpose: "CALLING", type: "FIXED", visibility: "PRIVATE", companyIds: [withPhone.id, noPhone.id] });
    if (!("success" in created)) throw new Error("failed");
    const list = await testPrisma.salesList.findUniqueOrThrow({ where: { id: created.id } });

    const currentUser = await getCurrentUser();
    const summary = await getListEligibilitySummary(currentUser!, list, "CALLING");
    expect(summary).toEqual({ eligible: 1, ineligible: 1 });
  });

  it("counts ineligible companies for an EMAIL_CAMPAIGN list when the primary contact has opted out", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const eligible = await createCompanyFixture({ name: "Eligible Co", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    const ineligible = await createCompanyFixture({ name: "Ineligible Co", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });

    const goodContact = await testPrisma.contact.create({ data: { companyId: eligible.id, firstName: "Good", lastName: "Contact", email: "good@example.test", doNotContact: false } });
    await testPrisma.company.update({ where: { id: eligible.id }, data: { primaryContactId: goodContact.id } });

    const optedOutContact = await testPrisma.contact.create({ data: { companyId: ineligible.id, firstName: "Opted", lastName: "Out", email: "opted@example.test", doNotContact: true } });
    await testPrisma.company.update({ where: { id: ineligible.id }, data: { primaryContactId: optedOutContact.id } });

    const created = await createSalesList({ name: "Campaign Eligibility", purpose: "EMAIL_CAMPAIGN", type: "FIXED", visibility: "PRIVATE", companyIds: [eligible.id, ineligible.id] });
    if (!("success" in created)) throw new Error("failed");
    const list = await testPrisma.salesList.findUniqueOrThrow({ where: { id: created.id } });

    const currentUser = await getCurrentUser();
    const summary = await getListEligibilitySummary(currentUser!, list, "EMAIL_CAMPAIGN");
    expect(summary).toEqual({ eligible: 1, ineligible: 1 });
  });
});

describe("unauthorized access rejection", () => {
  it("a user without view_sales_lists cannot see a private list, even by direct id", async () => {
    const ownerRole = await createRoleWithPermissions("Owner6", ["view_sales_lists", "create_sales_lists"]);
    const owner = await createTestUser({ roleId: ownerRole.id });
    const outsiderRole = await createRoleWithPermissions("Outsider6", []);
    const outsider = await createTestUser({ roleId: outsiderRole.id });

    await loginAs(owner.id);
    const created = await createSalesList({ name: "Private List", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: {} });
    if (!("success" in created)) throw new Error("failed");

    await loginAs(outsider.id);
    const outsiderUser = await getCurrentUser();
    expect(await getSalesListById(outsiderUser!, created.id)).toBeNull();
  });

  it("rejects addCompaniesToList without manage rights, even with view_sales_lists", async () => {
    const ownerRole = await createRoleWithPermissions("Owner7", ["view_sales_lists", "create_sales_lists"]);
    const owner = await createTestUser({ roleId: ownerRole.id });
    const viewerRole = await createRoleWithPermissions("Viewer7", ["view_sales_lists"]);
    const viewer = await createTestUser({ roleId: viewerRole.id });

    await loginAs(owner.id);
    const created = await createSalesList({
      name: "Shared Fixed",
      purpose: "GENERAL_SALES",
      type: "FIXED",
      visibility: "SHARED_USERS",
      sharedUserIds: [viewer.id],
    });
    if (!("success" in created)) throw new Error("failed");

    const { leadType, stage } = await baseFixtures([]);
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: owner.id });

    await loginAs(viewer.id);
    const result = await addCompaniesToList(created.id, [company.id]);
    expect(result).toHaveProperty("error");
  });

  it("rejects refreshDynamicList entirely for a user without view_sales_lists", async () => {
    const ownerRole = await createRoleWithPermissions("Owner8", ["view_sales_lists", "create_sales_lists"]);
    const owner = await createTestUser({ roleId: ownerRole.id });
    const noAccessRole = await createRoleWithPermissions("NoAccess8", []);
    const noAccess = await createTestUser({ roleId: noAccessRole.id });

    await loginAs(owner.id);
    const created = await createSalesList({ name: "Refresh Reject", purpose: "GENERAL_SALES", type: "DYNAMIC", visibility: "PRIVATE", filters: {} });
    if (!("success" in created)) throw new Error("failed");

    await loginAs(noAccess.id);
    await expect(refreshDynamicList(created.id)).rejects.toThrow();
  });
});
