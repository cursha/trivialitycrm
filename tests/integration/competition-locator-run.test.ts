import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createCompetitorFixture,
  createLeadSearchFixture,
  createCompanyFixture,
  createPipelineStageFixture,
} from "../helpers/fixtures";
import { runSearchJob } from "../../src/lib/research/run-search";
import { MockCandidateDiscoveryProvider, MockEvidenceVerificationProvider } from "../../src/lib/research/providers/mock";
import type { ResearchCandidate } from "../../src/lib/research/providers/types";

// COMPETITOR mode's region/wrong-provider guards moved to pass-1
// (run-search.ts, gated on search.mode === "COMPETITOR") since they only
// need identification-level fields — see anthropic.ts's own comment on the
// two-pass split. This builds a full pass-1-shaped candidate for tests that
// need to override discover() output directly, rather than verify()'s.
function candidateFixture(overrides: Partial<ResearchCandidate>): ResearchCandidate {
  return {
    name: "Some Pub",
    address1: "1 Main St",
    city: "Denver",
    // Matches createLeadSearchFixture's own defaults (Canada/ON) — a test
    // overriding only competitorName (not region/country) must not
    // accidentally also trip the region-mismatch guard first.
    region: "ON",
    postalCode: null,
    country: "Canada",
    phone: null,
    email: null,
    websiteUrl: "https://example.test/some-pub",
    triviaStatus: "CURRENT_TRIVIA",
    competitorName: null,
    contactData: null,
    evidence: [],
    sources: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await resetDatabase();
  process.env.AI_PROVIDER = "mock";
  // Ensure the seeded verification-standard rejection reasons exist —
  // resetDatabase() truncates everything, this test doesn't run the full
  // seed script.
  for (const name of ["Outside Requested Country/Region", "Different Trivia Provider", "Insufficient Verifiable Evidence"]) {
    await testPrisma.rejectionReason.upsert({ where: { name }, update: {}, create: { name } });
  }
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["run_research", "review_research_results"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  const competitor = await createCompetitorFixture("Geeks Who Drink");
  return { user, leadType, competitor };
}

describe("runSearchJob — COMPETITOR mode verification guards", () => {
  it("rejects a candidate whose returned competitorName is a different trivia provider than the one searched for", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    // Wrong-provider now runs on pass-1 (discover()) output directly — see
    // run-search.ts's own comment — since evidence-gathering (verify()) is
    // deferred to the opt-in "Research this business" pass and would be
    // empty at this point regardless.
    vi.spyOn(MockCandidateDiscoveryProvider.prototype, "discover").mockResolvedValue([candidateFixture({ competitorName: "A Totally Different Trivia Co" })]);
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "COMPETITOR", competitorId: competitor.id, cities: ["Denver"] });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id }, include: { rejectionReason: true } });
    expect(result.disposition).toBe("REJECTED");
    expect(result.competitorId).toBeNull();
    expect(result.rejectionReason?.name).toBe("Different Trivia Provider");
  });

  it("still trusts an exact match against the searched-for competitor's own name", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "COMPETITOR", competitorId: competitor.id, cities: ["Denver"] });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.disposition).not.toBe("REJECTED");
    expect(result.competitorId).toBe(competitor.id);
    // Pass-1 only — score/evidence stay at their unresearched placeholders
    // until "Research this business" (researchResult()) runs.
    expect(result.score).toBe(0);
    expect(result.evidence).toEqual([]);
  });

  it("rejects a candidate outside the searched country/region", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    // Region/country mismatch also now runs on pass-1 (discover()) output —
    // both fields are already present on the raw candidate, so this stays a
    // free, automatic check with no paid call.
    vi.spyOn(MockCandidateDiscoveryProvider.prototype, "discover").mockResolvedValue([
      candidateFixture({ region: "TX", country: "United States", competitorName: competitor.name }),
    ]);
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      mode: "COMPETITOR",
      competitorId: competitor.id,
      country: "Canada",
      region: "ON",
      cities: ["Milton"],
    });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id }, include: { rejectionReason: true } });
    expect(result.disposition).toBe("REJECTED");
    expect(result.rejectionReason?.name).toBe("Outside Requested Country/Region");
  });

  it("does not apply any COMPETITOR-only guard to a GENERAL-mode search", async () => {
    const { user, leadType } = await baseFixtures();
    vi.spyOn(MockEvidenceVerificationProvider.prototype, "verify").mockImplementation(async (candidate) => ({
      ...candidate,
      evidence: [{ category: "general", note: "unverified mention", sourceUrl: null, verificationStatus: "UNVERIFIED" }],
    }));
    // GENERAL mode never calls verify() at all (unresearched directory
    // listings) — this just confirms the search still succeeds normally
    // and isn't rejected by a guard that should only apply to COMPETITOR.
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "GENERAL", cities: ["Milton"] });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.disposition).toBe("NEW");
  });
});

describe("runSearchJob — COMPETITOR mode duplicate/conflict detection", () => {
  it("populates duplicateMatches/duplicateConfidence for a name+address match against an existing company", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({
      name: "Mock Pub Denver0",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: null,
      createdById: user.id,
      city: "Denver",
      region: "CO",
      country: "United States",
    });
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      mode: "COMPETITOR",
      competitorId: competitor.id,
      country: "United States",
      region: "CO",
      cities: ["Denver"],
    });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.duplicateConfidence).not.toBeNull();
    expect(Array.isArray(result.duplicateMatches)).toBe(true);
    expect((result.duplicateMatches as unknown[]).length).toBeGreaterThan(0);
  });

  it("flags competitorConflict when the matched company already has a different competitor on file", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    const otherCompetitor = await createCompetitorFixture("Trivia Kings");
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({
      name: "Mock Pub Denver0",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: null,
      createdById: user.id,
      city: "Denver",
      region: "CO",
      country: "United States",
      competitorId: otherCompetitor.id,
    });
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      mode: "COMPETITOR",
      competitorId: competitor.id,
      country: "United States",
      region: "CO",
      cities: ["Denver"],
    });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.competitorConflict).toBe(true);
  });

  it("does not flag competitorConflict when the matched company has no competitor on file yet", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({
      name: "Mock Pub Denver0",
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: null,
      createdById: user.id,
      city: "Denver",
      region: "CO",
      country: "United States",
      competitorId: null,
    });
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      mode: "COMPETITOR",
      competitorId: competitor.id,
      country: "United States",
      region: "CO",
      cities: ["Denver"],
    });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(result.competitorConflict).toBe(false);
  });
});
