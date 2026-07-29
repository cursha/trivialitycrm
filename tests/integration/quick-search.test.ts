import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies, RedirectSignal } from "../setup/mock-next";
import { startQuickSearch } from "../../src/app/(dashboard)/leads/searches/quick/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function quickSearchFormData(leadTypeIds: string[], overrides: Record<string, string> = {}) {
  const fd = new FormData();
  for (const id of leadTypeIds) fd.append("leadTypeIds", id);
  const defaults: Record<string, string> = { country: "Canada", region: "ON" };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) fd.set(k, v);
  return fd;
}

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["run_research"]);
  const user = await createTestUser({ roleId: role.id });
  return { user };
}

describe("startQuickSearch", () => {
  it("requires at least one Lead Type checked", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    const result = await startQuickSearch(undefined, quickSearchFormData([]));
    expect(result?.error).toMatch(/lead type/i);
    expect(await testPrisma.leadSearch.count()).toBe(0);
  });

  it("creates one GENERAL-mode, prompt-less LeadSearch per checked Lead Type and redirects to the batch page", async () => {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    const golf = await createLeadTypeFixture("Golf Clubs");
    await loginAs(user.id);

    let redirectUrl: string | undefined;
    try {
      await startQuickSearch(undefined, quickSearchFormData([pubs.id, golf.id]));
    } catch (error) {
      redirectUrl = (error as RedirectSignal).url;
    }

    const searches = await testPrisma.leadSearch.findMany({ orderBy: { createdAt: "asc" } });
    expect(searches).toHaveLength(2);
    for (const search of searches) {
      expect(search.mode).toBe("GENERAL");
      expect(search.promptId).toBeNull();
      expect(search.minimumScore).toBe(0);
    }
    expect(searches.map((s) => s.leadTypeId).sort()).toEqual([golf.id, pubs.id].sort());

    expect(redirectUrl).toBe(`/leads/searches/quick/batch?ids=${searches.map((s) => s.id).join(",")}`);
  });

  it("redirects straight to the search page when only one Lead Type is checked", async () => {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    await loginAs(user.id);

    let redirectUrl: string | undefined;
    try {
      await startQuickSearch(undefined, quickSearchFormData([pubs.id]));
    } catch (error) {
      redirectUrl = (error as RedirectSignal).url;
    }

    const search = await testPrisma.leadSearch.findFirstOrThrow();
    expect(redirectUrl).toBe(`/leads/searches/${search.id}`);
  });
});
