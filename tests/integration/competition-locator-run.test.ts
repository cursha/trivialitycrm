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
import { MockEvidenceVerificationProvider } from "../../src/lib/research/providers/mock";

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
  it("rejects a candidate whose evidence points to a different trivia provider than the one searched for", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    vi.spyOn(MockEvidenceVerificationProvider.prototype, "verify").mockImplementation(async (candidate) => ({
      ...candidate,
      competitorName: "A Totally Different Trivia Co",
      evidence: [{ category: "general", note: "found", sourceUrl: candidate.websiteUrl, verificationStatus: "VERIFIED" }],
    }));
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
  });

  it("rejects a candidate outside the searched country/region", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    vi.spyOn(MockEvidenceVerificationProvider.prototype, "verify").mockImplementation(async (candidate) => ({
      ...candidate,
      region: "TX",
      country: "United States",
      evidence: [{ category: "general", note: "found", sourceUrl: candidate.websiteUrl, verificationStatus: "VERIFIED" }],
    }));
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

  it("rejects a candidate with no current VERIFIED evidence", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    vi.spyOn(MockEvidenceVerificationProvider.prototype, "verify").mockImplementation(async (candidate) => ({
      ...candidate,
      evidence: [{ category: "general", note: "unverified mention", sourceUrl: null, verificationStatus: "UNVERIFIED" }],
    }));
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "COMPETITOR", competitorId: competitor.id, cities: ["Denver"] });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id }, include: { rejectionReason: true } });
    expect(result.disposition).toBe("REJECTED");
    expect(result.rejectionReason?.name).toBe("Insufficient Verifiable Evidence");
  });

  it("stamps verifiedAt on VERIFIED evidence entries, and never on non-VERIFIED ones", async () => {
    const { user, leadType, competitor } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "COMPETITOR", competitorId: competitor.id, cities: ["Denver"] });

    await runSearchJob(search.id);

    const [result] = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    const evidence = result.evidence as { verificationStatus: string; verifiedAt?: string | null }[];
    expect(evidence.length).toBeGreaterThan(0);
    for (const entry of evidence) {
      if (entry.verificationStatus === "VERIFIED") expect(entry.verifiedAt).toBeTruthy();
      else expect(entry.verifiedAt).toBeFalsy();
    }
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
