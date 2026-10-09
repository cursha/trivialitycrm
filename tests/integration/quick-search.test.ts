import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies, RedirectSignal } from "../setup/mock-next";
import { startQuickSearch, saveCityList, deleteCityList, findTowns } from "../../src/app/(dashboard)/leads/searches/quick/actions";

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

describe("startQuickSearch with trivia / karaoke", () => {
  async function run(fd: FormData) {
    try {
      return await startQuickSearch(undefined, fd);
    } catch (error) {
      if (error instanceof RedirectSignal) return undefined;
      throw error;
    }
  }

  it("saves what's ticked on each search, and describes it", async () => {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    await loginAs(user.id);

    const fd = quickSearchFormData([pubs.id]);
    fd.append("entertainment", "TRIVIA");
    fd.append("entertainment", "KARAOKE");
    fd.append("entertainment", "BINGO");
    fd.append("entertainment", "EVENTS");
    expect(await run(fd)).toBeUndefined();

    const search = await testPrisma.leadSearch.findFirstOrThrow();
    expect(search.entertainment).toEqual(["TRIVIA", "KARAOKE", "BINGO", "EVENTS"]);
    expect(search.promptSnapshot).toContain('"Pubs" offering trivia and/or karaoke and/or bingo and/or events');
  });

  it("saves the venue kinds to search for, and describes them", async () => {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    await loginAs(user.id);

    const fd = quickSearchFormData([pubs.id]);
    for (const kind of ["PUB", "BAR", "TAVERN"]) fd.append("venueKinds", kind);
    await run(fd);

    const search = await testPrisma.leadSearch.findFirstOrThrow();
    expect(search.venueKinds).toEqual(["PUB", "BAR", "TAVERN"]);
    expect(search.promptSnapshot).toContain('"Pubs" (searching for pubs, bars, taverns)');
  });

  it("refuses an unknown venue kind", async () => {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    await loginAs(user.id);

    const fd = quickSearchFormData([pubs.id]);
    fd.append("venueKinds", "NIGHTCLUB");
    expect((await run(fd))?.error).toBe("Choose pub, bar or tavern.");
    expect(await testPrisma.leadSearch.count()).toBe(0);
  });

  it("leaves chains out unless Include chains and franchises is ticked", async () => {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    await loginAs(user.id);

    await run(quickSearchFormData([pubs.id]));
    const unticked = await testPrisma.leadSearch.findFirstOrThrow();
    expect(unticked.excludeChains).toBe(true);
    expect(unticked.promptSnapshot).toContain("Chains and franchises left out.");

    await run(quickSearchFormData([pubs.id], { includeChains: "on" }));
    const ticked = await testPrisma.leadSearch.findFirstOrThrow({ where: { id: { not: unticked.id } } });
    expect(ticked.excludeChains).toBe(false);
    expect(ticked.promptSnapshot).not.toContain("Chains");
  });

  it("lists every venue when nothing is ticked", async () => {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    await loginAs(user.id);

    await run(quickSearchFormData([pubs.id]));
    const search = await testPrisma.leadSearch.findFirstOrThrow();
    expect(search.entertainment).toEqual([]);
    expect(search.venueKinds).toEqual([]);
  });

  it("refuses anything other than trivia, karaoke, bingo or events", async () => {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    await loginAs(user.id);

    const fd = quickSearchFormData([pubs.id]);
    fd.append("entertainment", "LIVE_MUSIC");
    expect((await run(fd))?.error).toBe("Choose trivia, karaoke, bingo or events.");
    expect(await testPrisma.leadSearch.count()).toBe(0);
  });
});


describe("startQuickSearch with a pasted list of cities", () => {
  async function start(cities: string[], perCity: boolean) {
    const { user } = await baseFixtures();
    const pubs = await createLeadTypeFixture("Pubs");
    await loginAs(user.id);
    const fd = quickSearchFormData([pubs.id]);
    for (const city of cities) fd.append("cities", city);
    if (perCity) fd.set("perCity", "on");
    let redirectUrl: string | undefined;
    try {
      await startQuickSearch(undefined, fd);
    } catch (error) {
      redirectUrl = (error as RedirectSignal).url;
    }
    return { redirectUrl, searches: await testPrisma.leadSearch.findMany({ orderBy: { createdAt: "asc" } }) };
  }

  it("runs each city as its own search when asked", async () => {
    const { redirectUrl, searches } = await start(["Milton", "Oakville", "Burlington"], true);

    expect(searches.map((s) => s.cities)).toEqual([["Milton"], ["Oakville"], ["Burlington"]]);
    expect(searches[0].promptSnapshot).toContain("in Milton, ON, Canada");
    expect(redirectUrl).toBe(`/leads/searches/quick/batch?ids=${searches.map((s) => s.id).join(",")}`);
  });

  it("keeps the cities together in one search otherwise", async () => {
    const { searches } = await start(["Milton", "Oakville"], false);

    expect(searches.map((s) => s.cities)).toEqual([["Milton", "Oakville"]]);
  });
});

describe("saved city lists", () => {
  const towns = { name: "West GTA towns", country: "Canada", region: "on", cities: ["Milton", "acton", "Georgetown"] };

  it("saves a list, replacing one with the same name, and deletes it", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    const first = await saveCityList(towns);
    expect(first).toMatchObject({ replaced: false });
    const saved = await testPrisma.cityList.findUniqueOrThrow({ where: { name: "West GTA towns" } });
    expect(saved).toMatchObject({ country: "Canada", region: "ON", cities: ["Milton", "Acton", "Georgetown"], createdById: user.id });

    const second = await saveCityList({ ...towns, cities: ["Milton"] });
    expect(second).toEqual({ id: saved.id, replaced: true });
    expect((await testPrisma.cityList.findUniqueOrThrow({ where: { id: saved.id } })).cities).toEqual(["Milton"]);

    expect(await deleteCityList(saved.id)).toEqual({});
    expect(await testPrisma.cityList.count()).toBe(0);
    expect(await deleteCityList(saved.id)).toEqual({ error: "That list no longer exists." });
  });

  it("needs a name and at least one city", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    expect(await saveCityList({ ...towns, name: "  " })).toEqual({ error: "Give the list a name." });
    expect(await saveCityList({ ...towns, cities: [] })).toEqual({ error: "Add at least one city to save." });
  });

  it("requires run_research", async () => {
    const role = await createRoleWithPermissions("Viewer", []);
    const viewer = await createTestUser({ roleId: role.id });
    await loginAs(viewer.id);

    await expect(saveCityList(towns)).rejects.toThrow();
  });
});

describe("findTowns", () => {
  it("returns the towns in a population range for someone who can run Quick Search", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    const outcome = await findTowns({ country: "Canada", region: "ON", min: "100,000", max: "150000" });
    if ("error" in outcome) throw new Error(outcome.error);
    expect(outcome.towns.map((town) => town.name)).toContain("Milton");
  });

  it("explains a bad range", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);

    expect(await findTowns({ country: "Canada", region: "ON", min: "", max: "" })).toEqual({ error: "Enter a smallest or largest population (or both)." });
  });

  it("refuses someone who can't run Quick Search", async () => {
    const role = await createRoleWithPermissions("Viewer", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(findTowns({ country: "Canada", region: "ON", min: "1000", max: "" })).rejects.toThrow();
  });
});
