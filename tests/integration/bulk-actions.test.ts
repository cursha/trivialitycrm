import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import {
  bulkChangeStage,
  bulkAssignCompanies,
  bulkArchive,
  bulkRestore,
  bulkAddNote,
} from "../../src/app/(dashboard)/companies/bulk-actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const bulkRole = await createRoleWithPermissions("BulkManager", [
    "view_all_leads",
    "edit_leads",
    "reassign_leads",
    "delete_leads",
    "restore_archived_leads",
    "bulk_update_leads",
  ]);
  const noBulkRole = await createRoleWithPermissions("EditOnly", ["view_all_leads", "edit_leads"]);

  const user = await createTestUser({ name: "Bulk User", roleId: bulkRole.id });
  const leadType = await createLeadTypeFixture();
  const stageA = await createPipelineStageFixture("New", { sortOrder: 0 });
  const stageB = await createPipelineStageFixture("Demo Given", { sortOrder: 1 });

  const companies = await Promise.all(
    Array.from({ length: 3 }).map((_, i) =>
      createCompanyFixture({ name: `Bulk Co ${i}`, leadTypeId: leadType.id, pipelineStageId: stageA.id, assignedToId: user.id, createdById: user.id }),
    ),
  );

  return { bulkRole, noBulkRole, user, leadType, stageA, stageB, companies };
}

describe("bulkChangeStage", () => {
  it("moves every selected company and logs one PIPELINE_CHANGE activity each", async () => {
    const { user, stageB, companies } = await baseFixtures();
    await loginAs(user.id);

    const result = await bulkChangeStage(companies.map((c) => c.id), stageB.id);

    expect("succeeded" in result && result.succeeded).toHaveLength(3);
    for (const company of companies) {
      const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
      expect(updated.pipelineStageId).toBe(stageB.id);
      expect(await testPrisma.activity.count({ where: { companyId: company.id, type: "PIPELINE_CHANGE" } })).toBe(1);
    }
  });

  it("excludes ids the caller cannot see and reports them as failed, without acting on them", async () => {
    const { user, stageB, companies, leadType, stageA } = await baseFixtures();
    const otherUser = await createTestUser({ name: "Other", roleId: user.roleId });
    const foreignCompany = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageA.id, assignedToId: otherUser.id, createdById: otherUser.id });

    // Give the caller only "view_assigned_leads"-equivalent scope by
    // swapping their role's view permission for a narrower one.
    const narrowRole = await createRoleWithPermissions("Narrow", ["view_assigned_leads", "edit_leads", "reassign_leads", "bulk_update_leads"]);
    await testPrisma.user.update({ where: { id: user.id }, data: { roleId: narrowRole.id } });

    await loginAs(user.id);
    const result = await bulkChangeStage([companies[0].id, foreignCompany.id], stageB.id);

    expect("succeeded" in result).toBe(true);
    if ("succeeded" in result) {
      expect(result.succeeded).toEqual([companies[0].id]);
      expect(result.failed).toEqual([{ id: foreignCompany.id, reason: "Not found or access denied." }]);
    }
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: foreignCompany.id } })).pipelineStageId).toBe(stageA.id);
  });

  it("rejects the whole call when the target stage does not exist", async () => {
    const { user, companies } = await baseFixtures();
    await loginAs(user.id);

    const result = await bulkChangeStage(companies.map((c) => c.id), "not-a-real-stage-id");
    expect(result).toEqual({ error: "That pipeline stage is not available." });
  });

  it("denies a user without bulk_update_leads", async () => {
    const { noBulkRole, companies, stageB } = await baseFixtures();
    const limited = await createTestUser({ roleId: noBulkRole.id });
    await loginAs(limited.id);

    await expect(bulkChangeStage(companies.map((c) => c.id), stageB.id)).rejects.toThrow(/Forbidden/);
  });
});

describe("bulkAssignCompanies", () => {
  it("reassigns every selected company and logs ASSIGNMENT_CHANGE for each", async () => {
    const { user, companies } = await baseFixtures();
    const newOwner = await createTestUser({ name: "New Owner", roleId: user.roleId });
    await loginAs(user.id);

    const result = await bulkAssignCompanies(companies.map((c) => c.id), newOwner.id);

    expect("succeeded" in result && result.succeeded).toHaveLength(3);
    for (const company of companies) {
      expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).assignedToId).toBe(newOwner.id);
      expect(await testPrisma.activity.count({ where: { companyId: company.id, type: "ASSIGNMENT_CHANGE" } })).toBe(1);
    }
  });
});

describe("bulkArchive / bulkRestore", () => {
  it("archives every selected active company, is idempotent for already-archived ones", async () => {
    const { user, companies } = await baseFixtures();
    await testPrisma.company.update({ where: { id: companies[0].id }, data: { status: "ARCHIVED", archivedAt: new Date() } });

    await loginAs(user.id);
    const result = await bulkArchive(companies.map((c) => c.id));

    expect("succeeded" in result && result.succeeded).toHaveLength(3);
    for (const company of companies) {
      expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).status).toBe("ARCHIVED");
    }
  });

  it("restores archived companies back to active", async () => {
    const { user, companies } = await baseFixtures();
    await testPrisma.company.updateMany({ where: { id: { in: companies.map((c) => c.id) } }, data: { status: "ARCHIVED", archivedAt: new Date() } });

    await loginAs(user.id);
    const result = await bulkRestore(companies.map((c) => c.id));

    expect("succeeded" in result && result.succeeded).toHaveLength(3);
    for (const company of companies) {
      expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).status).toBe("ACTIVE");
    }
  });
});

describe("bulkAddNote", () => {
  it("creates one NOTE activity per selected company with the same text", async () => {
    const { user, companies } = await baseFixtures();
    await loginAs(user.id);

    const result = await bulkAddNote(companies.map((c) => c.id), "Called about renewal");

    expect("succeeded" in result && result.succeeded).toHaveLength(3);
    for (const company of companies) {
      const notes = await testPrisma.activity.findMany({ where: { companyId: company.id, type: "NOTE" } });
      expect(notes).toHaveLength(1);
      expect(notes[0].notes).toBe("Called about renewal");
    }
  });

  it("rejects an empty note without writing anything", async () => {
    const { user, companies } = await baseFixtures();
    await loginAs(user.id);

    const result = await bulkAddNote(companies.map((c) => c.id), "   ");
    expect(result).toEqual({ error: "Enter a note." });
    expect(await testPrisma.activity.count()).toBe(0);
  });
});
