import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createCompanyFixture,
  createLeadSearchFixture,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createRoleWithPermissions,
  createSearchResultFixture,
  createTestUser,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { deleteLeadType } from "../../src/app/(dashboard)/settings/lead-types/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function adminFixture() {
  const role = await createRoleWithPermissions("Administrator", ["manage_settings"]);
  const admin = await createTestUser({ roleId: role.id });
  await loginAs(admin.id);
  return admin;
}

describe("deleteLeadType", () => {
  it("deletes an unused lead type and audits it", async () => {
    const admin = await adminFixture();
    const leadType = await createLeadTypeFixture("Retirement");

    expect(await deleteLeadType(leadType.id)).toBeUndefined();

    expect(await testPrisma.leadType.findUnique({ where: { id: leadType.id } })).toBeNull();
    const audit = await testPrisma.auditEvent.findFirstOrThrow({ where: { action: "lead_type.deleted" } });
    expect(audit.actorId).toBe(admin.id);
  });

  it("asks for a replacement when only a lead search uses it (no companies)", async () => {
    const admin = await adminFixture();
    const leadType = await createLeadTypeFixture("Retirement");
    await createLeadSearchFixture({ createdById: admin.id, leadTypeId: leadType.id });

    const result = await deleteLeadType(leadType.id);

    expect(result).toEqual({ error: '"Retirement" is used by 1 lead search. Choose a lead type to move them to, then delete.', needsReplacement: true, searches: 1, othersInUse: false });
    expect(await testPrisma.leadType.findUnique({ where: { id: leadType.id } })).not.toBeNull();
  });

  it("moves companies, searches and routes to the replacement, then deletes", async () => {
    const admin = await adminFixture();
    const stage = await createPipelineStageFixture();
    const retirement = await createLeadTypeFixture("Retirement");
    const pub = await createLeadTypeFixture("Pub Trivia");
    const company = await createCompanyFixture({ leadTypeId: retirement.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
    const search = await createLeadSearchFixture({ createdById: admin.id, leadTypeId: retirement.id });
    const route = await testPrisma.routePlan.create({ data: { userId: admin.id, leadTypeId: retirement.id, country: "Canada" } });

    expect(await deleteLeadType(retirement.id, { replacementId: pub.id })).toBeUndefined();

    expect(await testPrisma.leadType.findUnique({ where: { id: retirement.id } })).toBeNull();
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).leadTypeId).toBe(pub.id);
    expect((await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } })).leadTypeId).toBe(pub.id);
    expect((await testPrisma.routePlan.findUniqueOrThrow({ where: { id: route.id } })).leadTypeId).toBe(pub.id);
  });

  it("deletes its lead searches and their results instead of moving them", async () => {
    const admin = await adminFixture();
    const retirement = await createLeadTypeFixture("Retirement");
    const search = await createLeadSearchFixture({ createdById: admin.id, leadTypeId: retirement.id });
    await createSearchResultFixture({ searchId: search.id });
    await testPrisma.leadSearch.update({ where: { id: search.id }, data: { status: "SUCCEEDED" } });

    expect(await deleteLeadType(retirement.id, { deleteSearches: true })).toBeUndefined();

    expect(await testPrisma.leadType.findUnique({ where: { id: retirement.id } })).toBeNull();
    expect(await testPrisma.leadSearch.count()).toBe(0);
    expect(await testPrisma.searchResult.count()).toBe(0);
    const audit = await testPrisma.auditEvent.findFirstOrThrow({ where: { action: "lead_type.deleted" } });
    expect(audit.metadata).toMatchObject({ searchesDeleted: 1 });
  });

  it("deleting searches still needs a replacement for its companies, and keeps them", async () => {
    const admin = await adminFixture();
    const stage = await createPipelineStageFixture();
    const retirement = await createLeadTypeFixture("Retirement");
    const pub = await createLeadTypeFixture("Pub Trivia");
    const company = await createCompanyFixture({ leadTypeId: retirement.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
    const search = await createLeadSearchFixture({ createdById: admin.id, leadTypeId: retirement.id });
    await testPrisma.leadSearch.update({ where: { id: search.id }, data: { status: "SUCCEEDED" } });

    expect(await deleteLeadType(retirement.id, { deleteSearches: true })).toMatchObject({ needsReplacement: true, othersInUse: true });
    expect(await deleteLeadType(retirement.id, { deleteSearches: true, replacementId: pub.id })).toBeUndefined();

    expect(await testPrisma.leadSearch.count()).toBe(0);
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).leadTypeId).toBe(pub.id);
  });

  it("won't delete a search that is still running", async () => {
    const admin = await adminFixture();
    const retirement = await createLeadTypeFixture("Retirement");
    const search = await createLeadSearchFixture({ createdById: admin.id, leadTypeId: retirement.id });
    await testPrisma.leadSearch.update({ where: { id: search.id }, data: { status: "RUNNING" } });

    expect((await deleteLeadType(retirement.id, { deleteSearches: true }))?.error).toMatch(/still running/);
    expect(await testPrisma.leadType.findUnique({ where: { id: retirement.id } })).not.toBeNull();
  });

  it("refuses to move a lead type into itself", async () => {
    const admin = await adminFixture();
    const leadType = await createLeadTypeFixture("Retirement");
    await createLeadSearchFixture({ createdById: admin.id, leadTypeId: leadType.id });

    expect((await deleteLeadType(leadType.id, { replacementId: leadType.id }))?.error).toBeTruthy();
    expect(await testPrisma.leadType.findUnique({ where: { id: leadType.id } })).not.toBeNull();
  });

  it("requires manage_settings", async () => {
    const role = await createRoleWithPermissions("Rep", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Retirement");

    await expect(deleteLeadType(leadType.id)).rejects.toThrow();
  });
});
