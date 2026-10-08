import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createLeadSearchFixture, createSearchResultFixture, loginAs } from "../helpers/fixtures";
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

const { findResultEmails } = await import("../../src/app/(dashboard)/leads/searches/[id]/results/actions");

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function setup(permissions = ["review_research_results"]) {
  const role = await createRoleWithPermissions("Reviewer", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "GENERAL", cities: ["Milton"] });
  await loginAs(user.id);
  return { user, search };
}

describe("findResultEmails", () => {
  it("fills empty emails from the website, notes why when it can't, and never overwrites one", async () => {
    const { search } = await setup();
    const found = await createSearchResultFixture({ searchId: search.id, name: "Found Pub", websiteUrl: "https://found.example.test" });
    const noSite = await createSearchResultFixture({ searchId: search.id, name: "No Site Pub", websiteUrl: null });
    const social = await createSearchResultFixture({ searchId: search.id, name: "Social Pub", websiteUrl: "https://www.facebook.com/socialpub" });
    const hasEmail = await createSearchResultFixture({ searchId: search.id, name: "Has Email Pub", email: "owner@hasemail.test", websiteUrl: "https://found.example.test" });

    const outcome = await findResultEmails([found.id, noSite.id, social.id, hasEmail.id]);

    expect(outcome).toEqual({ checked: 3, found: 1, skipped: 1 });
    const rows = new Map((await testPrisma.searchResult.findMany()).map((row) => [row.id, row]));
    expect(rows.get(found.id)).toMatchObject({ email: "info@found.example.test", emailLookupNote: null });
    expect(rows.get(found.id)?.emailLookupAt).toBeInstanceOf(Date);
    expect(rows.get(noSite.id)).toMatchObject({ email: null, emailLookupNote: "No website on file" });
    expect(rows.get(social.id)?.emailLookupNote).toMatch(/social media/);
    expect(rows.get(hasEmail.id)).toMatchObject({ email: "owner@hasemail.test", emailLookupAt: null });

    const audit = await testPrisma.auditEvent.findFirst({ where: { action: "results.emails_looked_up" } });
    expect(audit?.metadata).toEqual({ checked: 3, found: 1 });
  });

  it("needs a venue ticked, and at most 25", async () => {
    await setup();
    expect(await findResultEmails([])).toEqual({ error: "Tick at least one venue first." });
    expect(await findResultEmails(Array.from({ length: 26 }, (_, i) => `id-${i}`))).toEqual({ error: "Choose 25 venues or fewer at a time." });
  });

  it("requires review_research_results", async () => {
    await setup([]);
    await expect(findResultEmails(["any"])).rejects.toThrow();
  });
});
