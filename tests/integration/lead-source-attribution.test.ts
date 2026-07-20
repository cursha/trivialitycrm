import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createLeadSearchFixture,
  createSearchResultFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { transferSearchResults } from "../../src/app/(dashboard)/leads/transfer/actions";
import { putUpload } from "../../src/lib/import/batch-store";
import { commitImport } from "../../src/app/(dashboard)/leads/import/actions";
import type { TransferRow } from "../../src/lib/validation/transfer";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("Company.source attribution", () => {
  it("sets source AI_RESEARCH (and writes an initial PipelineStageHistory row) on transfer", async () => {
    const role = await createRoleWithPermissions("Administrator", ["transfer_leads"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture("Pub");
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });
    const result = await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle" });
    await loginAs(user.id);

    const row: TransferRow = {
      resultId: result.id,
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
      overrideDuplicate: false,
    };

    await transferSearchResults({ assignedToId: user.id, pipelineStageId: stage.id, rows: [row] });

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "The Copper Kettle" } });
    expect(company.source).toBe("AI_RESEARCH");
    expect(company.importBatchId).toBeNull();

    const history = await testPrisma.pipelineStageHistory.findMany({ where: { companyId: company.id } });
    expect(history).toHaveLength(1);
    expect(history[0].fromStageId).toBeNull();
    expect(history[0].toStageId).toBe(stage.id);
  });

  it("sets source IMPORT and importBatchId (and writes an initial PipelineStageHistory row) on import commit", async () => {
    const role = await createRoleWithPermissions("Importer", ["import_leads"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture("Pub");
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await loginAs(user.id);

    const mapping = { name: "Name", city: "City", region: "Region", country: "Country" };
    const sessionId = await putUpload(user.id, "leads.csv", {
      headers: ["Name", "City", "Region", "Country"],
      rows: [{ Name: "New Bar", City: "Ottawa", Region: "ON", Country: "Canada" }],
    });

    const result = await commitImport(sessionId, mapping, [0], leadType.id, stage.id, user.id);
    if ("error" in result) throw new Error(result.error);
    expect(result.importedCount).toBe(1);

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "New Bar" } });
    expect(company.source).toBe("IMPORT");
    expect(company.importBatchId).toBe(sessionId);

    const history = await testPrisma.pipelineStageHistory.findMany({ where: { companyId: company.id } });
    expect(history).toHaveLength(1);
    expect(history[0].fromStageId).toBeNull();
    expect(history[0].toStageId).toBe(stage.id);
  });
});
