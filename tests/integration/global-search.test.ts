import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, fetchAuthenticatedUser } from "../helpers/fixtures";
import { globalSearch, MIN_QUERY_LENGTH } from "../../src/lib/search/global-search";

beforeEach(async () => {
  await resetDatabase();
});

describe("globalSearch", () => {
  it("returns nothing below the minimum query length", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);

    const results = await globalSearch(user, "a".repeat(MIN_QUERY_LENGTH - 1));
    expect(results).toEqual({ companies: [], contacts: [], competitors: [] });
  });

  it("finds a company by name, city, and phone", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const company = await createCompanyFixture({ name: "The Copper Kettle", city: "Milton", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await testPrisma.company.update({ where: { id: company.id }, data: { phone: "555-0100" } });

    expect((await globalSearch(user, "Copper")).companies.map((c) => c.id)).toContain(company.id);
    expect((await globalSearch(user, "Milton")).companies.map((c) => c.id)).toContain(company.id);
    expect((await globalSearch(user, "555-0100")).companies.map((c) => c.id)).toContain(company.id);
  });

  it("finds a contact by name and email, showing the parent company", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const company = await createCompanyFixture({ name: "The Copper Kettle", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" } });

    const byName = await globalSearch(user, "Jamie");
    expect(byName.contacts).toHaveLength(1);
    expect(byName.contacts[0].subtitle).toContain("The Copper Kettle");

    const byEmail = await globalSearch(user, "jamie@example.com");
    expect(byEmail.contacts).toHaveLength(1);
  });

  it("finds an active competitor by name, but not an inactive one", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    await testPrisma.competitor.create({ data: { name: "Geeks Who Drink", active: true } });
    await testPrisma.competitor.create({ data: { name: "Trivia Retired Co", active: false } });

    const results = await globalSearch(user, "Geeks");
    expect(results.competitors.map((c) => c.title)).toEqual(["Geeks Who Drink"]);

    const inactive = await globalSearch(user, "Retired");
    expect(inactive.competitors).toHaveLength(0);
  });

  it("excludes MERGED companies and contacts", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const survivor = await createCompanyFixture({ name: "Survivor Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    const merged = await createCompanyFixture({ name: "Merged Away Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await testPrisma.company.update({ where: { id: merged.id }, data: { status: "MERGED", mergedIntoId: survivor.id, mergedAt: new Date() } });

    const results = await globalSearch(user, "Bar");
    expect(results.companies.map((c) => c.id)).toContain(survivor.id);
    expect(results.companies.map((c) => c.id)).not.toContain(merged.id);
  });

  it("includes an ARCHIVED company (findable, not hidden — status isn't the access boundary)", async () => {
    const role = await createRoleWithPermissions("Viewer", ["view_all_leads"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const company = await createCompanyFixture({ name: "Archived Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await testPrisma.company.update({ where: { id: company.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });

    const results = await globalSearch(user, "Archived");
    expect(results.companies.map((c) => c.id)).toContain(company.id);
    expect(results.companies[0].subtitle).toContain("Archived");
  });

  // The core security property: a Salesperson scoped to only their own
  // assigned companies must never see another salesperson's company or
  // contact in global search results, exactly like every other scoped
  // query in this app.
  it("respects companyScope — a Salesperson never sees another salesperson's company or contact", async () => {
    const salesRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const salesperson = await fetchAuthenticatedUser((await createTestUser({ name: "Sales A", roleId: salesRole.id })).id);
    const otherRole = await createRoleWithPermissions("OtherSales", ["view_assigned_leads"]);
    const other = await createTestUser({ name: "Sales B", roleId: otherRole.id });

    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const mine = await createCompanyFixture({ name: "Mine Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: salesperson.id, createdById: salesperson.id });
    const notMine = await createCompanyFixture({ name: "Not Mine Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: other.id, createdById: other.id });
    await testPrisma.contact.create({ data: { companyId: notMine.id, firstName: "Hidden", lastName: "Contact" } });

    const results = await globalSearch(salesperson, "Bar");
    expect(results.companies.map((c) => c.id)).toEqual([mine.id]);

    const contactResults = await globalSearch(salesperson, "Hidden");
    expect(contactResults.contacts).toHaveLength(0);
  });

  it("returns nothing when the caller has no view permission at all (null scope)", async () => {
    const role = await createRoleWithPermissions("NoView", ["add_leads"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({ name: "Invisible Bar", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });

    const results = await globalSearch(user, "Invisible");
    expect(results.companies).toHaveLength(0);
  });
});
