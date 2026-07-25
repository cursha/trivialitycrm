import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createLeadSearchFixture } from "../helpers/fixtures";
import { runSearchJob } from "../../src/lib/research/run-search";
import { MockEvidenceVerificationProvider, MockScoringProvider } from "../../src/lib/research/providers/mock";
import type { ResearchCandidate } from "../../src/lib/research/providers/types";

// CANDIDATE_CONCURRENCY (run-search.ts) is 3 — these tests use 5 candidates
// specifically so processing spans two batches (3 + 2), proving the batched
// rewrite doesn't skip, duplicate, or corrupt anything at the batch boundary
// that a single-batch (<=3 candidate) test couldn't catch.

beforeEach(async () => {
  await resetDatabase();
  process.env.AI_PROVIDER = "mock";
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeCandidate(name: string): ResearchCandidate {
  return {
    name,
    address1: "1 Main St",
    city: "Milton",
    region: "ON",
    postalCode: null,
    country: "Canada",
    phone: null,
    email: null,
    websiteUrl: null,
    contactData: null,
    triviaStatus: "UNCERTAIN",
    competitorName: null,
    evidence: [],
    sources: [],
  };
}

async function seedCandidates(searchId: string, count: number) {
  await testPrisma.$transaction(
    Array.from({ length: count }, (_, index) =>
      testPrisma.searchCandidate.create({
        data: {
          searchId,
          index,
          normalizedIdentity: `candidate-${index}`,
          rawCandidate: fakeCandidate(`Mock Business ${index}`) as unknown as object,
        },
      }),
    ),
  );
}

describe("runSearchJob — batched candidate processing", () => {
  it("processes every candidate exactly once across a batch boundary (5 candidates, batch size 3)", async () => {
    const role = await createRoleWithPermissions("Administrator", ["run_research", "review_research_results"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    await seedCandidates(search.id, 5);

    const verifySpy = vi.spyOn(MockEvidenceVerificationProvider.prototype, "verify");
    const scoreSpy = vi.spyOn(MockScoringProvider.prototype, "score");

    await runSearchJob(search.id);

    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("SUCCEEDED");
    expect(updated.candidatesFound).toBe(5);

    const candidates = await testPrisma.searchCandidate.findMany({ where: { searchId: search.id } });
    expect(candidates).toHaveLength(5);
    expect(candidates.every((c) => c.status === "COMPLETED")).toBe(true);

    const results = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(results).toHaveLength(5);
    // Every candidate got its own distinct result — no batch-boundary
    // collision overwriting or skipping one.
    expect(new Set(results.map((r) => r.candidateId)).size).toBe(5);

    expect(verifySpy).toHaveBeenCalledTimes(5);
    expect(scoreSpy).toHaveBeenCalledTimes(5);
  }, 20000);

  it("a mid-second-batch failure leaves every first-batch candidate fully COMPLETED, not orphaned mid-write", async () => {
    const role = await createRoleWithPermissions("Administrator", ["run_research", "review_research_results"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    await seedCandidates(search.id, 5);

    let verifyCalls = 0;
    vi.spyOn(MockEvidenceVerificationProvider.prototype, "verify").mockImplementation(async (candidate) => {
      verifyCalls += 1;
      // Fail exactly one candidate in the second batch (calls 4-5).
      if (verifyCalls === 4) throw new Error("Simulated failure in the second batch.");
      return candidate;
    });

    await runSearchJob(search.id);

    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("FAILED");

    // The first batch (3 candidates) must be fully, unambiguously COMPLETED
    // — never left dangling because a sibling in a later batch failed.
    const candidates = await testPrisma.searchCandidate.findMany({ where: { searchId: search.id }, orderBy: { index: "asc" } });
    const firstBatch = candidates.slice(0, 3);
    expect(firstBatch.every((c) => c.status === "COMPLETED")).toBe(true);

    const firstBatchResults = await testPrisma.searchResult.findMany({
      where: { searchId: search.id, candidateId: { in: firstBatch.map((c) => c.id) } },
    });
    expect(firstBatchResults).toHaveLength(3);
  }, 20000);
});
