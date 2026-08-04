import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createCompetitorFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { startCompetitionLocatorRun } from "../../src/app/(dashboard)/leads/competition-locator/actions";
import { ForbiddenError } from "../../src/lib/auth/permissions";
import { ALL_NORTH_AMERICAN_REGIONS } from "../../src/lib/constants/north-american-regions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  process.env.AI_PROVIDER = "mock";
});

function formDataFor(competitorId: string, leadTypeId: string, regions: string[] = []) {
  const fd = new FormData();
  fd.set("competitorId", competitorId);
  fd.set("leadTypeId", leadTypeId);
  for (const region of regions) fd.append("regions", region);
  return fd;
}

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["run_competition_locator"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  const competitor = await createCompetitorFixture("Geeks Who Drink");
  return { user, leadType, competitor };
}

describe("startCompetitionLocatorRun", () => {
  it("requires the run_competition_locator permission", async () => {
    const role = await createRoleWithPermissions("Salesperson", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const competitor = await createCompetitorFixture("Geeks Who Drink");

    await expect(startCompetitionLocatorRun(undefined, formDataFor(competitor.id, leadType.id, ["United States|CO"]))).rejects.toThrow(ForbiddenError);
  });

  it("creates one child LeadSearch per selected region, all sharing one runCorrelationId", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    await loginAs(user.id);

    await expect(
      startCompetitionLocatorRun(undefined, formDataFor(competitor.id, leadType.id, ["United States|CO", "Canada|ON"])),
    ).rejects.toThrow(); // redirect() throws internally in the test environment

    const searches = await testPrisma.leadSearch.findMany({ where: { competitorId: competitor.id, mode: "COMPETITOR" } });
    expect(searches).toHaveLength(2);
    expect(new Set(searches.map((s) => s.runCorrelationId)).size).toBe(1);
    expect(searches.every((s) => s.runCorrelationId !== null)).toBe(true);
    const regions = searches.map((s) => `${s.country}|${s.region}`).sort();
    expect(regions).toEqual(["Canada|ON", "United States|CO"]);
  });

  it("expands a blank region selection to every US state + Canadian province", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    await loginAs(user.id);

    await expect(startCompetitionLocatorRun(undefined, formDataFor(competitor.id, leadType.id, []))).rejects.toThrow();

    const searches = await testPrisma.leadSearch.findMany({ where: { competitorId: competitor.id, mode: "COMPETITOR" } });
    expect(searches).toHaveLength(ALL_NORTH_AMERICAN_REGIONS.length);
  });

  it("requires a competitor to be chosen", async () => {
    const { user, leadType } = await baseFixtures();
    await loginAs(user.id);

    const result = await startCompetitionLocatorRun(undefined, formDataFor("", leadType.id, ["United States|CO"]));
    expect(result?.error).toBeTruthy();
  });

  it("rejects a second run once the per-user daily search limit is reached, counting the whole run as one unit", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    await loginAs(user.id);
    await testPrisma.aiSettings.create({ data: { id: 1, perUserDailySearchLimit: 1 } });

    // First run: even though it expands to multiple regions, it must only
    // consume ONE unit of the daily limit — never blocks mid-run.
    await expect(
      startCompetitionLocatorRun(undefined, formDataFor(competitor.id, leadType.id, ["United States|CO", "Canada|ON", "United States|TX"])),
    ).rejects.toThrow();
    const firstRunSearches = await testPrisma.leadSearch.count({ where: { competitorId: competitor.id } });
    expect(firstRunSearches).toBe(3);

    // Second run: now blocked, since the daily limit (1 run) was already used.
    const result = await startCompetitionLocatorRun(undefined, formDataFor(competitor.id, leadType.id, ["United States|CO"]));
    expect(result?.error).toBeTruthy();
    const totalSearches = await testPrisma.leadSearch.count({ where: { competitorId: competitor.id } });
    expect(totalSearches).toBe(3); // unchanged — the second attempt created nothing
  });
});
