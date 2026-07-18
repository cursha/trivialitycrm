import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createCompetitorFixture, createLeadSearchFixture, createSearchResultFixture } from "../helpers/fixtures";
import { runSearchJob } from "../../src/lib/research/run-search";

beforeEach(async () => {
  await resetDatabase();
  process.env.AI_PROVIDER = "mock";
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["run_research", "review_research_results"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  return { user, leadType };
}

describe("runSearchJob", () => {
  it("runs a GENERAL search end-to-end and marks it SUCCEEDED", async () => {
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton", "Oakville"] });

    await runSearchJob(search.id);

    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("SUCCEEDED");
    expect(updated.candidatesFound).toBe(2);
    expect(updated.completedAt).not.toBeNull();

    const results = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.normalizedName.length > 0)).toBe(true);
  });

  it("respects the geographic filter — statewide when cities is empty", async () => {
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: [], region: "BC" });

    await runSearchJob(search.id);

    const results = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(results).toHaveLength(1);
    expect(results[0].region).toBe("BC");
  });

  it("marks below-minimum-score candidates BELOW_SCORE, not NEW", async () => {
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton"], minimumScore: 95 });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.disposition).toBe("BELOW_SCORE");
  });

  it("auto-rejects a candidate matching a previously rejected result", async () => {
    const { user, leadType } = await baseFixtures();
    const priorSearch = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });
    // Mock discovery names candidates deterministically from lead type + city — match that shape.
    await createSearchResultFixture({ searchId: priorSearch.id, name: "Mock Pub Milton0", city: "Milton", disposition: "REJECTED" });

    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton"] });
    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.disposition).toBe("REJECTED");
    expect(result.explanation).toContain("Auto-rejected");
  });

  it("links a confirmed competitor to an existing Competitor record", async () => {
    const { user, leadType } = await baseFixtures();
    const competitor = await createCompetitorFixture("Geeks Who Drink");
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      cities: ["Denver"],
      mode: "COMPETITOR",
      competitorId: competitor.id,
    });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.competitorId).toBe(competitor.id);
    expect(result.triviaStatus).toBe("CURRENT_TRIVIA");
  });

  it("never produces a CURRENT_TRIVIA result for a TRIVIA_GAP search", async () => {
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton"], mode: "TRIVIA_GAP" });

    await runSearchJob(search.id);

    const results = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(results.every((r) => r.triviaStatus !== "CURRENT_TRIVIA")).toBe(true);
  });

  it("marks the search FAILED with an error message if a provider step throws", async () => {
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });

    // Force a provider failure by pointing at a non-existent provider mid-run.
    process.env.AI_PROVIDER = "not-a-real-provider";
    await runSearchJob(search.id);
    process.env.AI_PROVIDER = "mock";

    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.errorMessage).toBeTruthy();
  });
});
