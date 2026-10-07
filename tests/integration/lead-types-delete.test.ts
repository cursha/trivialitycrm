import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createCompanyFixture,
  createLeadSearchFixture,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createRoleWithPermissions,
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

    expect(result).toEqual({ error: '"Retirement" is used by 1 lead search. Choose a lead type to move them to, then delete.', needsReplacement: true });
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

    expect(await deleteLeadType(retirement.id, pub.id)).toBeUndefined();

    expect(await testPrisma.leadType.findUnique({ where: { id: retirement.id } })).toBeNull();
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).leadTypeId).toBe(pub.id);
    expect((await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } })).leadTypeId).toBe(pub.id);
    expect((await testPrisma.routePlan.findUniqueOrThrow({ where: { id: route.id } })).leadTypeId).toBe(pub.id);
  });

  it("refuses to move a lead type into itself", async () => {
    const admin = await adminFixture();
    const leadType = await createLeadTypeFixture("Retirement");
    await createLeadSearchFixture({ createdById: admin.id, leadTypeId: leadType.id });

    expect((await deleteLeadType(leadType.id, leadType.id))?.error).toBeTruthy();
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
