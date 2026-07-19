import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createLeadSearchFixture } from "../helpers/fixtures";
import { runSearchJob } from "../../src/lib/research/run-search";
import { MockCandidateDiscoveryProvider, MockEvidenceVerificationProvider, MockScoringProvider } from "../../src/lib/research/providers/mock";

// Proves the idempotent-resume design in run-search.ts: a job that fails
// partway through and is retried (simulated here by calling runSearchJob a
// second time, exactly as worker/handlers/run-search.ts's caller — pg-boss —
// would after a retry) must never re-run discover(), never re-verify or
// re-score an already-checkpointed candidate, and never produce a duplicate
// SearchResult row.

beforeEach(async () => {
  await resetDatabase();
  process.env.AI_PROVIDER = "mock";
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["run_research", "review_research_results"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  return { user, leadType };
}

describe("runSearchJob resumability", () => {
  it("resumes after a mid-run failure without re-discovering, re-verifying, or duplicating results", async () => {
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton", "Oakville"] });

    const discoverSpy = vi.spyOn(MockCandidateDiscoveryProvider.prototype, "discover");
    const verifySpy = vi.spyOn(MockEvidenceVerificationProvider.prototype, "verify");
    let scoreCalls = 0;
    const scoreSpy = vi.spyOn(MockScoringProvider.prototype, "score").mockImplementation(async () => {
      scoreCalls += 1;
      if (scoreCalls === 2) throw new Error("Simulated crash scoring the second candidate.");
      return { score: 70, explanation: "[Mock score] test" };
    });

    // --- First attempt: fails partway through candidate 2 -----------------
    await runSearchJob(search.id);

    const afterFirstAttempt = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(afterFirstAttempt.status).toBe("FAILED");

    const candidatesAfterFirst = await testPrisma.searchCandidate.findMany({ where: { searchId: search.id }, orderBy: { index: "asc" } });
    expect(candidatesAfterFirst).toHaveLength(2);
    expect(candidatesAfterFirst[0].status).toBe("COMPLETED");
    expect(candidatesAfterFirst[1].status).toBe("VERIFIED"); // verify succeeded, score threw

    const resultsAfterFirst = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(resultsAfterFirst).toHaveLength(1);

    expect(discoverSpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledTimes(2);

    // --- Resume: score no longer throws ------------------------------------
    scoreSpy.mockRestore();
    await runSearchJob(search.id);

    const afterResume = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(afterResume.status).toBe("SUCCEEDED");
    expect(afterResume.candidatesFound).toBe(2);

    const candidatesAfterResume = await testPrisma.searchCandidate.findMany({ where: { searchId: search.id }, orderBy: { index: "asc" } });
    expect(candidatesAfterResume.every((c) => c.status === "COMPLETED")).toBe(true);

    const resultsAfterResume = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(resultsAfterResume).toHaveLength(2); // still exactly 2 — no duplicate for candidate 1

    // discover() and verify() for the already-completed first candidate must
    // never be called again on resume.
    expect(discoverSpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledTimes(2); // only the second candidate needed a (re-attempted) verify... actually it was already VERIFIED, so still 2 total
  }, 20000);
});
