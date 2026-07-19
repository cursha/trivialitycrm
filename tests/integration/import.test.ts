import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { putUpload } from "../../src/lib/import/batch-store";
import { previewImport, commitImport, saveImportTemplate } from "../../src/app/(dashboard)/leads/import/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

const mapping = { name: "Name", city: "City", region: "Region", country: "Country", contactFirstName: "First", contactLastName: "Last" };

async function baseFixtures() {
  const role = await createRoleWithPermissions("Importer", ["import_leads", "manage_settings"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  return { user, leadType, stage };
}

describe("import preview and commit", () => {
  it("previews rows with validation errors and duplicate flags", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    await createCompanyFixture({ name: "The Copper Kettle", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });

    const sessionId = await putUpload(user.id, "leads.csv", {
      headers: ["Name", "City", "Region", "Country", "First", "Last"],
      rows: [
        { Name: "The Copper Kettle", City: "Milton", Region: "ON", Country: "Canada", First: "", Last: "" },
        { Name: "", City: "Oakville", Region: "ON", Country: "Canada", First: "", Last: "" },
        { Name: "New Bar", City: "Ottawa", Region: "ON", Country: "Canada", First: "Jane", Last: "Doe" },
      ],
    });

    const result = await previewImport(sessionId, mapping);
    if ("error" in result) throw new Error(result.error);

    expect(result.rows[0].duplicateOf).toBe("The Copper Kettle");
    expect(result.rows[1].errors).toContain('Missing required field "name".');
    expect(result.rows[2].errors).toHaveLength(0);
    expect(result.rows[2].duplicateOf).toBeNull();
  });

  it("commits valid, non-duplicate rows and attaches a contact to a duplicate match instead of creating a second company", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
    });

    const sessionId = await putUpload(user.id, "leads.csv", {
      headers: ["Name", "City", "Region", "Country", "First", "Last"],
      rows: [
        { Name: "The Copper Kettle", City: "Milton", Region: "ON", Country: "Canada", First: "Jane", Last: "Doe" },
        { Name: "New Bar", City: "Ottawa", Region: "ON", Country: "Canada", First: "John", Last: "Smith" },
      ],
    });

    const result = await commitImport(sessionId, mapping, [0, 1], leadType.id, stage.id, user.id);
    if ("error" in result) throw new Error(result.error);

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(await testPrisma.company.count()).toBe(2);

    const contactOnExisting = await testPrisma.contact.findFirst({ where: { companyId: existing.id } });
    expect(contactOnExisting?.firstName).toBe("Jane");
  });

  it("never persists uploaded rows to the database — commit reads only from the in-memory session", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);

    const sessionId = await putUpload(user.id, "leads.csv", {
      headers: ["Name", "City", "Region", "Country"],
      rows: [{ Name: "New Bar", City: "Ottawa", Region: "ON", Country: "Canada" }],
    });

    await commitImport(sessionId, mapping, [0], leadType.id, stage.id, user.id);

    // A second commit against the same (now-cleared) session must not find rows again.
    const secondAttempt = await commitImport(sessionId, mapping, [0], leadType.id, stage.id, user.id);
    expect("error" in secondAttempt).toBe(true);
  });

  it("saves a reusable mapping template", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    await saveImportTemplate("Standard Mapping", mapping);

    const template = await testPrisma.importTemplate.findFirstOrThrow({ where: { name: "Standard Mapping" } });
    expect((template.mapping as Record<string, string>).name).toBe("Name");
    expect(template.createdById).toBe(user.id);
  });
});
