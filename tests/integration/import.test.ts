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
    await createCompanyFixture({ name: "The Copper Kettle", city: "Milton", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });

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

    expect(result.rows[0].match?.name).toBe("The Copper Kettle");
    expect(result.rows[1].errors).toContain('Missing required field "name".');
    expect(result.rows[2].errors).toHaveLength(0);
    expect(result.rows[2].match).toBeNull();
  });

  it("commits valid, non-duplicate rows and attaches a contact to a duplicate match instead of creating a second company", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const existing = await createCompanyFixture({
      name: "The Copper Kettle",
      city: "Milton",
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
    expect(result.updatedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
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

  // Module Ten regression: commitImport (a per-row-writing bulk operation,
  // up to 5000 rows/upload) had no rate limit at all.
  it("is rate-limited", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);

    const outcomes = [];
    for (let i = 0; i < 6; i++) {
      const sessionId = await putUpload(user.id, "leads.csv", {
        headers: ["Name", "City", "Region", "Country"],
        rows: [{ Name: `Rate Limit Bar ${i}`, City: "Ottawa", Region: "ON", Country: "Canada" }],
      });
      outcomes.push(await commitImport(sessionId, mapping, [0], leadType.id, stage.id, user.id));
    }
    expect(outcomes.some((o) => "error" in o && o.error.includes("Too many"))).toBe(true);
  });
});

describe("import research fields and contact data", () => {
  const researchMapping = {
    name: "name",
    city: "city",
    region: "region",
    country: "country",
    phone: "phone",
    contactFirstName: "contactFirstName",
    contactLastName: "contactLastName",
    contactTitle: "contactTitle",
    contactPhone: "contactPhone",
    contactNote: "contactNote",
    notes: "notes",
    researchPriority: "researchPriority",
    currentEntertainment: "currentEntertainment",
    triviaStatus: "triviaStatus",
    competitorTriviaProvider: "competitorTriviaProvider",
    competitorTriviaDay: "competitorTriviaDay",
    slowNight: "slowNight",
    triviaHistory: "triviaHistory",
    missingInformation: "missingInformation",
    needsReview: "needsReview",
    // Not import fields — must be ignored even when a file maps them.
    eosScore: "eosScore",
    opportunityGrade: "opportunityGrade",
  };

  function row(overrides: Record<string, string>): Record<string, string> {
    return { name: "Keenans Pub", city: "Brampton", region: "ON", country: "Canada", ...overrides };
  }

  async function importRows(userId: string, leadTypeId: string, stageId: string, rows: Record<string, string>[], filename = "research.csv") {
    const sessionId = await putUpload(userId, filename, { headers: Object.keys(rows[0]), rows });
    const preview = await previewImport(sessionId, researchMapping);
    if ("error" in preview) throw new Error(preview.error);
    const result = await commitImport(sessionId, researchMapping, preview.rows.map((r) => r.index), leadTypeId, stageId, userId);
    if ("error" in result) throw new Error(result.error);
    return { preview, result };
  }

  it("saves research fields on a new company, with the research priority at the top of its notes", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);

    await importRows(user.id, leadType.id, stage.id, [
      row({
        researchPriority: "high",
        notes: "Owner is friendly",
        currentEntertainment: "Karaoke Thu, bands Sat",
        triviaStatus: "yes",
        competitorTriviaDay: "mon",
        slowNight: "Tues",
        triviaHistory: "Tremendous Trivia started Jan 2026, now cancelled",
        missingInformation: "Confirm the trivia night",
        needsReview: "yes",
      }),
    ]);

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "Keenans Pub" } });
    expect(company.notes).toBe("Research priority: High\nOwner is friendly");
    expect(company.currentEntertainment).toBe("Karaoke Thu, bands Sat");
    expect(company.triviaStatus).toBe("CURRENT_TRIVIA");
    expect(company.competitorTriviaDay).toBe("MONDAY");
    expect(company.slowNight).toBe("TUESDAY");
    expect(company.triviaHistory).toContain("now cancelled");
    expect(company.missingInformation).toBe("Confirm the trivia night");
    expect(company.needsReview).toBe(true);
    expect(company.needsReviewReason).toBe("Confirm the trivia night");
  });

  it("keeps a contact note in the company notes", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);

    await importRows(user.id, leadType.id, stage.id, [row({ contactFirstName: "Jane", contactLastName: "Doe", contactNote: "Prefers mornings" })]);

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "Keenans Pub" }, include: { contacts: true } });
    expect(company.notes).toBe("Contact note (Jane Doe): Prefers mornings");
    expect(company.contacts.map((c) => c.lastName)).toEqual(["Doe"]);
  });

  it("saves a first-name-only contact as a company note, with a warning in the preview", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);

    const { preview } = await importRows(user.id, leadType.id, stage.id, [row({ contactFirstName: "Sam", contactTitle: "Owner", contactPhone: "905-555-0100" })]);

    expect(preview.rows[0].warnings).toContain("No last name, so this contact will be saved as a company note.");
    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "Keenans Pub" }, include: { contacts: true } });
    expect(company.contacts).toHaveLength(0);
    expect(company.notes).toBe("Contact: Sam — Owner · 905-555-0100");
  });

  it("links a provider name to a matching Competitor, but not In-house", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const ruby = await testPrisma.competitor.create({ data: { name: "Ruby Pub Trivia" } });

    await importRows(user.id, leadType.id, stage.id, [
      row({ competitorTriviaProvider: "ruby PUB TRIVIA", competitorTriviaDay: "Monday" }),
      row({ name: "Barra Fion", competitorTriviaProvider: "In-house" }),
      row({ name: "The Unknown", competitorTriviaProvider: "Some New Company" }),
    ]);

    const keenans = await testPrisma.company.findFirstOrThrow({ where: { name: "Keenans Pub" } });
    expect(keenans.competitorId).toBe(ruby.id);
    expect(keenans.competitorTriviaProvider).toBe("ruby PUB TRIVIA");
    expect(keenans.competitorTriviaDay).toBe("MONDAY");
    const barra = await testPrisma.company.findFirstOrThrow({ where: { name: "Barra Fion" } });
    expect(barra.competitorId).toBeNull();
    expect(barra.competitorTriviaProvider).toBe("In-house");
    // Only an existing Competitor is linked; none is created.
    expect((await testPrisma.company.findFirstOrThrow({ where: { name: "The Unknown" } })).competitorId).toBeNull();
    expect(await testPrisma.competitor.count()).toBe(1);
  });

  it("fills only empty fields on a matching company, appends notes once, and changes nothing on a re-import", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const otherType = await createLeadTypeFixture("Golf Club");
    const existing = await createCompanyFixture({
      name: "Keenans Pub",
      city: "Brampton",
      leadTypeId: otherType.id,
      pipelineStageId: stage.id,
      assignedToId: user.id,
      createdById: user.id,
    });
    await testPrisma.company.update({
      where: { id: existing.id },
      data: { phone: "905-555-0199", currentEntertainment: "Live bands", notes: "Met the owner", triviaStatus: "NO_CURRENT_TRIVIA" },
    });
    const rows = [
      row({
        phone: "905-555-0100",
        currentEntertainment: "Karaoke",
        triviaHistory: "Had trivia in 2025",
        triviaStatus: "yes",
        slowNight: "Wed",
        researchPriority: "Medium",
        notes: "Busy on weekends",
      }),
    ];

    const { preview, result } = await importRows(user.id, leadType.id, stage.id, rows, "pubs.csv");

    expect(preview.rows[0].match?.name).toBe("Keenans Pub");
    expect(preview.rows[0].match?.fills).toEqual(["Trivia history", "Slow night"]);
    expect(preview.rows[0].match?.addsNotes).toBe(true);
    expect(result).toMatchObject({ importedCount: 0, updatedCount: 1, skippedCount: 0 });

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.phone).toBe("905-555-0199");
    expect(updated.currentEntertainment).toBe("Live bands");
    expect(updated.triviaStatus).toBe("NO_CURRENT_TRIVIA");
    expect(updated.triviaHistory).toBe("Had trivia in 2025");
    expect(updated.slowNight).toBe("WEDNESDAY");
    expect(updated.leadTypeId).toBe(otherType.id);
    expect(updated.source).toBeNull();
    expect(updated.notes).toMatch(/^Met the owner\n\n— Imported \d{4}-\d{2}-\d{2} \(pubs\.csv\) —\nResearch priority: Medium\nBusy on weekends$/);

    const again = await importRows(user.id, leadType.id, stage.id, rows, "pubs.csv");
    expect(again.preview.rows[0].match).toMatchObject({ fills: [], addsNotes: false, addsContact: false });
    expect(again.result).toMatchObject({ importedCount: 0, updatedCount: 0, skippedCount: 1 });
    const unchanged = await testPrisma.company.findUniqueOrThrow({ where: { id: existing.id } });
    expect(unchanged.notes).toBe(updated.notes);
    expect(unchanged.updatedAt).toEqual(updated.updatedAt);
    expect(await testPrisma.company.count()).toBe(1);
  });

  it("does not add the same contact twice when a file is imported again", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const rows = [row({ contactFirstName: "Jane", contactLastName: "Doe" })];

    await importRows(user.id, leadType.id, stage.id, rows);
    const again = await importRows(user.id, leadType.id, stage.id, rows);

    expect(again.result).toMatchObject({ importedCount: 0, updatedCount: 0, skippedCount: 1 });
    expect(await testPrisma.contact.count()).toBe(1);
  });

  it("never writes scoring fields, even when the file has those columns", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);

    await importRows(user.id, leadType.id, stage.id, [row({ eosScore: "99", opportunityGrade: "A" })]);

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "Keenans Pub" } });
    expect(company.eosScore).toBeNull();
    expect(company.opportunityGrade).toBeNull();
    expect(company.salesPriorityScore).toBeNull();
    expect(company.lastScoredAt).toBeNull();
  });
});
