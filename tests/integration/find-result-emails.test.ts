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

const { findResultEmails, searchWebForResultEmails } = await import("../../src/app/(dashboard)/leads/searches/[id]/results/actions");
const { getAiResearchReport } = await import("../../src/app/(dashboard)/reports/ai-research/queries");
const { requireUser } = await import("../../src/lib/auth/current-user");

// Several fixtures per test put these near the 5s default on this machine.
vi.setConfig({ testTimeout: 20_000 });

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
    expect(rows.get(found.id)).toMatchObject({ email: "info@found.example.test", emailSource: "WEBSITE", emailLookupNote: null });
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

describe("searchWebForResultEmails", () => {
  it("searches only venues with no email that were never web-searched, and records where each came from", async () => {
    const { search } = await setup(["run_research"]);
    const found = await createSearchResultFixture({ searchId: search.id, name: "Keenans Pub", websiteUrl: "https://www.facebook.com/keenans" });
    const missing = await createSearchResultFixture({ searchId: search.id, name: "No Email Tavern" });
    const already = await createSearchResultFixture({ searchId: search.id, name: "Searched Before Pub" });
    await testPrisma.searchResult.update({ where: { id: already.id }, data: { emailWebSearchAt: new Date(), emailLookupNote: "No email found in a web search" } });
    const hasEmail = await createSearchResultFixture({ searchId: search.id, name: "Has Email Pub", email: "owner@hasemail.test" });

    const outcome = await searchWebForResultEmails([found.id, missing.id, already.id, hasEmail.id]);

    expect(outcome).toEqual({ checked: 2, found: 1, skipped: 2 });
    const rows = new Map((await testPrisma.searchResult.findMany()).map((row) => [row.id, row]));
    expect(rows.get(found.id)).toMatchObject({ email: "info@keenanspub.example.test", emailSource: "WEB_SEARCH", emailLookupNote: "Found by web search (facebook.com)" });
    expect(rows.get(missing.id)).toMatchObject({ email: null, emailSource: null, emailLookupNote: "No email found in a web search" });
    expect(rows.get(missing.id)?.emailWebSearchAt).toBeInstanceOf(Date);
    expect(rows.get(hasEmail.id)?.emailWebSearchAt).toBeNull();
  });

  it("needs run_research, since it spends AI budget", async () => {
    await setup(["review_research_results"]);
    await expect(searchWebForResultEmails(["any"])).rejects.toThrow();
  });

  it("takes at most 10 venues at a time", async () => {
    await setup(["run_research"]);
    expect(await searchWebForResultEmails(Array.from({ length: 11 }, (_, i) => `id-${i}`))).toEqual({ error: "Choose 10 venues or fewer at a time for a web search." });
  });
});

describe("AI research report: finding emails", () => {
  it("shows what each way of finding emails found, how many were transferred, and the cost per email", async () => {
    const { user, search } = await setup(["run_research", "view_all_reports", "view_ai_costs"]);
    const now = new Date();
    await createSearchResultFixture({ searchId: search.id, name: "Site Find" }).then((r) =>
      testPrisma.searchResult.update({ where: { id: r.id }, data: { email: "a@site.test", emailSource: "WEBSITE", emailLookupAt: now } }),
    );
    await createSearchResultFixture({ searchId: search.id, name: "Site Miss" }).then((r) => testPrisma.searchResult.update({ where: { id: r.id }, data: { emailLookupAt: now } }));
    await createSearchResultFixture({ searchId: search.id, name: "Web Find Transferred" }).then((r) =>
      testPrisma.searchResult.update({ where: { id: r.id }, data: { email: "b@web.test", emailSource: "WEB_SEARCH", emailWebSearchAt: now, disposition: "TRANSFERRED" } }),
    );
    await createSearchResultFixture({ searchId: search.id, name: "Web Miss" }).then((r) => testPrisma.searchResult.update({ where: { id: r.id }, data: { emailWebSearchAt: now } }));
    for (const cost of [0.06, 0.08]) {
      await testPrisma.aiUsageRecord.create({
        data: { searchId: search.id, userId: user.id, provider: "anthropic", operation: "findEmail", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 100, estimatedCostUsd: cost },
      });
    }

    const report = await getAiResearchReport(await requireUser(), { dateRange: "month" });

    expect(report?.emailFinding).toMatchObject({ websiteChecked: 2, websiteFound: 1, webSearched: 2, webFound: 1, webFoundTransferred: 1 });
    expect(report?.emailFinding.webSearchCostUsd).toBeCloseTo(0.14);
    expect(report?.emailFinding.costPerWebEmailUsd).toBeCloseTo(0.14);
  });
});
