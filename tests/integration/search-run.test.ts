import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createCompetitorFixture, createLeadSearchFixture, createSearchResultFixture } from "../helpers/fixtures";
import { runSearchJob } from "../../src/lib/research/run-search";
import { MockCandidateDiscoveryProvider } from "../../src/lib/research/providers/mock";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("GENERAL mode never auto-verifies or auto-scores — candidates stay UNCERTAIN, unresearched, and NEW", async () => {
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton"], minimumScore: 95 });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    // minimumScore is 95 — if the initial run were still auto-scoring (the
    // bug this test guards against), a placeholder/low score would push
    // this to BELOW_SCORE, hiding it from the default results view before
    // anyone had a chance to research it.
    expect(result.disposition).toBe("NEW");
    expect(result.triviaStatus).toBe("UNCERTAIN");
    expect(result.evidence).toEqual([]);
    expect(result.score).toBe(0);
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
    // TRIVIA_GAP, not the GENERAL default — GENERAL-mode candidates are
    // unresearched directory listings with a placeholder score (see
    // run-search.ts), always disposition NEW regardless of minimumScore,
    // until a user opts into "Research this business". This test is about
    // the real score-vs-minimumScore comparison, which only applies once a
    // candidate has actually been AI-scored.
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton"], minimumScore: 95, mode: "TRIVIA_GAP" });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.disposition).toBe("BELOW_SCORE");
  });

  it("auto-rejects a candidate matching a previously rejected result", async () => {
    const { user, leadType } = await baseFixtures();
    const priorSearch = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    // TRIVIA_GAP, not GENERAL — GENERAL now routes to the mock *places*
    // provider by default (see factory.ts), whose naming differs from the
    // AI mock discovery provider's "Mock {leadType} {city}{index}" shape
    // this fixture name is matching. This test is about the rejection-
    // matching integration in run-search.ts, not discovery-provider
    // selection, so pinning to a non-GENERAL mode preserves its intent.
    await createSearchResultFixture({ searchId: priorSearch.id, name: "Mock Pub Milton0", city: "Milton", disposition: "REJECTED" });

    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton"], mode: "TRIVIA_GAP" });
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

  it("sanitizes a raw provider failure into a safe message instead of storing it verbatim", async () => {
    // Regression test: run-search.ts previously stored `error.message`
    // directly from a failed discover()/verify()/score() call — a raw
    // provider error (confirmed live: an Anthropic 529 "overloaded"
    // response, and separately a "credit balance too low" 400) would show
    // its full raw text on the search status page instead of the same
    // classifyProviderError() safe message every other AI-provider call
    // site produces.
    const { user, leadType } = await baseFixtures();
    // TRIVIA_GAP, not the createLeadSearchFixture default of GENERAL —
    // GENERAL mode's discovery routes through MockPlacesProvider instead of
    // MockCandidateDiscoveryProvider (see factory.ts), so this spy would
    // never fire under the default mode.
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton"], mode: "TRIVIA_GAP" });

    const rawMessage = "529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}";
    vi.spyOn(MockCandidateDiscoveryProvider.prototype, "discover").mockRejectedValueOnce(new Error(rawMessage));

    await runSearchJob(search.id);

    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.errorMessage).toBeTruthy();
    expect(updated.errorMessage).not.toContain(rawMessage);
    expect(updated.errorMessage).not.toContain("overloaded_error");
  });

  it("checkpoints discovered candidates with a generous transaction timeout, not Prisma's 5s default", async () => {
    // Regression test: the discovery-checkpoint bulk upsert previously
    // called prisma.$transaction([...]) with no explicit timeout, which
    // defaults to 5s — confirmed live to fail once a real search discovered
    // enough genuine candidates ("A commit cannot be executed on an expired
    // transaction... 5505 ms passed since the start."). Locks in the fix
    // (an explicit { timeout: 30_000 }) rather than only re-testing the
    // symptom, since a slow-transaction repro isn't practical in tests.
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton"], mode: "TRIVIA_GAP" });

    const transactionSpy = vi.spyOn(testPrisma, "$transaction");

    await runSearchJob(search.id);

    const bulkUpsertCall = transactionSpy.mock.calls.find((call) => Array.isArray(call[0]));
    expect(bulkUpsertCall).toBeDefined();
    expect(bulkUpsertCall?.[1]).toEqual({ timeout: 30_000 });
  });
});
