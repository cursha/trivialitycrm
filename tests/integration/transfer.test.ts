import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createLeadSearchFixture,
  createSearchResultFixture,
  createCompanyFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { transferSearchResults } from "../../src/app/(dashboard)/leads/transfer/actions";
import type { TransferRow } from "../../src/lib/validation/transfer";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures(roleName = "Administrator", permissions = ["transfer_leads"]) {
  const role = await createRoleWithPermissions(roleName, permissions);
  const user = await createTestUser({ name: roleName, roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });
  return { user, leadType, stage, search };
}

function baseRow(resultId: string, overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    resultId,
    name: "The Copper Kettle",
    address1: undefined,
    city: "Milton",
    region: "ON",
    postalCode: undefined,
    country: "Canada",
    phone: undefined,
    email: undefined,
    websiteUrl: undefined,
    contactFirstName: undefined,
    contactLastName: undefined,
    contactPhone: undefined,
    contactEmail: undefined,
    contactTitle: undefined,
    contactNote: undefined,
    ...overrides,
  };
}

describe("transferSearchResults", () => {
  it("transfers a result into a new Company with a first contact and logs an activity", async () => {
    const { user, stage, search } = await baseFixtures();
    await loginAs(user.id);
    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle" });

    const outcome = await transferSearchResults({
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { contactFirstName: "Jane", contactLastName: "Doe" })],
    });

    expect(outcome).toEqual({ transferredCount: 1, ignoredCount: 0 });

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "The Copper Kettle" } });
    expect(company.leadTypeId).toBe(search.leadTypeId);
    expect(company.pipelineStageId).toBe(stage.id);

    const contact = await testPrisma.contact.findFirstOrThrow({ where: { companyId: company.id } });
    expect(contact.firstName).toBe("Jane");

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id } });
    expect(activity.type).toBe("LEAD_TRANSFERRED");

    const updatedResult = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(updatedResult.disposition).toBe("TRANSFERRED");
    expect(updatedResult.companyId).toBe(company.id);
  });

  it("blocks a non-admin from transferring a possible duplicate", async () => {
    const { stage, search, leadType } = await baseFixtures();
    const salesRole = await createRoleWithPermissions("Salesperson", ["transfer_leads", "add_leads"]);
    const salesperson = await createTestUser({ name: "Sales", roleId: salesRole.id });
    await loginAs(salesperson.id);

    await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: salesperson.id,
      createdById: salesperson.id,
    });
    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle" });

    const outcome = await transferSearchResults({
      assignedToId: salesperson.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id)],
    });

    expect("duplicates" in outcome).toBe(true);
    const companiesAfter = await testPrisma.company.count();
    expect(companiesAfter).toBe(1); // only the pre-existing one
  });

  it("rejects a non-admin's duplicateAction even if they somehow set one", async () => {
    const { stage, search, leadType } = await baseFixtures();
    const salesRole = await createRoleWithPermissions("Salesperson", ["transfer_leads", "add_leads"]);
    const salesperson = await createTestUser({ name: "Sales", roleId: salesRole.id });
    await loginAs(salesperson.id);

    await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: salesperson.id,
      createdById: salesperson.id,
    });
    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle" });

    const outcome = await transferSearchResults({
      assignedToId: salesperson.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { duplicateAction: "ignore" })],
    });

    expect(outcome).toEqual({ error: "Only an Administrator can resolve a possible duplicate match." });
  });

  it('"replace" overwrites the existing company\'s fields with the fresh data, without creating a new company', async () => {
    const { user, stage, search, leadType } = await baseFixtures();
    await loginAs(user.id);

    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
    });
    await testPrisma.company.update({ where: { id: existing.id }, data: { phone: "555-0000", email: "old@example.test" } });

    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle" });

    const outcome = await transferSearchResults({
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { phone: "555-9999", email: "fresh@example.test", duplicateAction: "replace", duplicateTargetCompanyId: existing.id })],
    });

    expect(outcome).toEqual({ transferredCount: 1, ignoredCount: 0 });
    expect(await testPrisma.company.count()).toBe(1); // no new company created

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.phone).toBe("555-9999");
    expect(updated.email).toBe("fresh@example.test");
    // Replace does not touch pipeline/assignment state.
    expect(updated.pipelineStageId).toBe(stage.id);

    const updatedResult = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(updatedResult.disposition).toBe("TRANSFERRED");
    expect(updatedResult.companyId).toBe(existing.id);
  });

  it('"merge" only fills fields the existing company doesn\'t already have, never overwriting data on file', async () => {
    const { user, stage, search, leadType } = await baseFixtures();
    await loginAs(user.id);

    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
    });
    await testPrisma.company.update({ where: { id: existing.id }, data: { phone: "555-0000", email: null } });

    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle" });

    const outcome = await transferSearchResults({
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { phone: "555-9999", email: "fresh@example.test", duplicateAction: "merge", duplicateTargetCompanyId: existing.id })],
    });

    expect(outcome).toEqual({ transferredCount: 1, ignoredCount: 0 });
    expect(await testPrisma.company.count()).toBe(1);

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.phone).toBe("555-0000"); // already had a value — kept as-is
    expect(updated.email).toBe("fresh@example.test"); // was blank — filled in
  });

  it('"ignore" skips the row entirely — no company change, disposition untouched', async () => {
    const { user, stage, search, leadType } = await baseFixtures();
    await loginAs(user.id);

    await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
    });
    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle" });

    const outcome = await transferSearchResults({
      assignedToId: user.id,
      pipelineStageId: stage.id,
      rows: [baseRow(result.id, { duplicateAction: "ignore" })],
    });

    expect(outcome).toEqual({ transferredCount: 0, ignoredCount: 1 });
    expect(await testPrisma.company.count()).toBe(1);

    const untouchedResult = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(untouchedResult.disposition).not.toBe("TRANSFERRED");
    expect(untouchedResult.companyId).toBeNull();
  });

  it("rolls back the whole batch — no companies, contacts, activities, or disposition changes — when the transaction fails", async () => {
    const { user, search } = await baseFixtures();
    await loginAs(user.id);
    const resultA = await createSearchResultFixture({ searchId: search.id, name: "Bar A" });
    const resultB = await createSearchResultFixture({ searchId: search.id, name: "Bar B" });

    await expect(
      transferSearchResults({
        assignedToId: user.id,
        pipelineStageId: "not-a-real-pipeline-stage-id",
        rows: [baseRow(resultA.id, { name: "Bar A" }), baseRow(resultB.id, { name: "Bar B" })],
      }),
    ).rejects.toThrow();

    expect(await testPrisma.company.count()).toBe(0);
    expect(await testPrisma.contact.count()).toBe(0);
    expect(await testPrisma.activity.count()).toBe(0);

    const [refreshedA, refreshedB] = await Promise.all([
      testPrisma.searchResult.findUniqueOrThrow({ where: { id: resultA.id } }),
      testPrisma.searchResult.findUniqueOrThrow({ where: { id: resultB.id } }),
    ]);
    expect(refreshedA.disposition).not.toBe("TRANSFERRED");
    expect(refreshedB.disposition).not.toBe("TRANSFERRED");
  });
});
