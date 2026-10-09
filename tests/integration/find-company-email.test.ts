import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";

// No real websites in tests: one address "has" an email, the rest go
// through the real lookup, which settles them without a network call.
vi.mock("../../src/lib/research/website-email", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/research/website-email")>();
  return {
    ...original,
    findEmailOnWebsite: async (url: string | null) => (url === "https://found.example.test" ? { email: "info@found.example.test", note: null } : original.findEmailOnWebsite(url)),
  };
});

const { findCompanyEmail, searchWebForCompanyEmail } = await import("../../src/app/(dashboard)/companies/[id]/find-email-actions");

vi.setConfig({ testTimeout: 20_000 });

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  process.env.AI_PROVIDER = "mock";
});

async function setup(permissions = ["view_all_leads", "edit_leads"], company: { name?: string; websiteUrl?: string | null; email?: string | null } = {}) {
  const role = await createRoleWithPermissions("Rep", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { sortOrder: 0 });
  const created = await createCompanyFixture({
    name: company.name,
    leadTypeId: leadType.id,
    pipelineStageId: stage.id,
    assignedToId: user.id,
    createdById: user.id,
    email: company.email ?? null,
  });
  await testPrisma.company.update({ where: { id: created.id }, data: { websiteUrl: company.websiteUrl ?? null } });
  await loginAs(user.id);
  return { user, company: created };
}

describe("findCompanyEmail", () => {
  it("saves an email found on the website and records it", async () => {
    const { company } = await setup(undefined, { websiteUrl: "https://found.example.test" });

    expect(await findCompanyEmail(company.id)).toEqual({ email: "info@found.example.test" });
    const saved = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(saved).toMatchObject({ email: "info@found.example.test", normalizedEmail: "info@found.example.test" });
    const audit = await testPrisma.auditEvent.findFirst({ where: { action: "company.email_found" } });
    expect(audit?.metadata).toEqual({ how: "website" });
  });

  it("says why when there's none, and offers the web search only to people who can run research", async () => {
    const { company } = await setup(undefined, { websiteUrl: null });
    expect(await findCompanyEmail(company.id)).toEqual({ email: null, note: "No website on file", canSearchWeb: false });
  });

  it("offers the web search to someone who can run research", async () => {
    const { company } = await setup(["view_all_leads", "edit_leads", "run_research"], { websiteUrl: "https://www.facebook.com/somepub" });
    expect(await findCompanyEmail(company.id)).toMatchObject({ email: null, canSearchWeb: true });
  });

  it("never replaces an email already on file", async () => {
    const { company } = await setup(undefined, { websiteUrl: "https://found.example.test", email: "owner@pub.test" });
    expect(await findCompanyEmail(company.id)).toEqual({ error: "This company already has an email." });
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).email).toBe("owner@pub.test");
  });

  it("requires edit_leads", async () => {
    const { company } = await setup(["view_all_leads"]);
    await expect(findCompanyEmail(company.id)).rejects.toThrow();
  });
});

describe("searchWebForCompanyEmail", () => {
  it("saves an email found by the web search", async () => {
    const { company } = await setup(["view_all_leads", "edit_leads", "run_research"], { name: "Web Pub" });

    expect(await searchWebForCompanyEmail(company.id)).toEqual({ email: "info@webpub.example.test" });
    expect((await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).email).toBe("info@webpub.example.test");
    const audit = await testPrisma.auditEvent.findFirst({ where: { action: "company.email_found" } });
    expect(audit?.metadata).toEqual({ how: "web_search", sourceHost: "facebook.com" });
  });

  it("says so when the web search finds nothing", async () => {
    const { company } = await setup(["view_all_leads", "edit_leads", "run_research"], { name: "No Email Pub" });
    expect(await searchWebForCompanyEmail(company.id)).toEqual({ email: null, note: "No email found in a web search", canSearchWeb: false });
  });

  it("requires run_research", async () => {
    const { company } = await setup();
    await expect(searchWebForCompanyEmail(company.id)).rejects.toThrow();
  });
});
