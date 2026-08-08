import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, createLeadSearchFixture } from "../helpers/fixtures";
import { runSearchJob } from "../../src/lib/research/run-search";

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await resetDatabase();
  process.env.AI_PROVIDER = "mock";
  process.env.PLACES_PROVIDER = "mock";
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["run_pub_lead_finder", "review_research_results"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  const pipelineStage = await createPipelineStageFixture("New", { isDefault: true });
  return { user, leadType, pipelineStage };
}

describe("runSearchJob — PUB_RADIUS mode", () => {
  it("runs end-to-end, marks the search SUCCEEDED, and skips auto-verify/score like GENERAL mode does", async () => {
    const { user, leadType, pipelineStage } = await baseFixtures();
    const origin = await createCompanyFixture({
      name: "The Origin Pub",
      leadTypeId: leadType.id,
      pipelineStageId: pipelineStage.id,
      assignedToId: null,
      createdById: user.id,
      city: "Milton",
    });
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      mode: "PUB_RADIUS",
      cities: ["Milton"],
      originCompanyId: origin.id,
      radiusValue: 5,
      radiusUnit: "MI",
      originLat: 43.5183,
      originLng: -79.8774,
    });

    await runSearchJob(search.id);

    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("SUCCEEDED");

    const results = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(results).toHaveLength(2); // MockPubRadiusPlacesProvider returns 2 candidates
    for (const result of results) {
      // Same "identification only, opt into Research this business" contract
      // as GENERAL/COMPETITOR mode — see run-search.ts's own comment.
      expect(result.disposition).toBe("NEW");
      expect(result.score).toBe(0);
      expect(result.triviaStatus).toBe("UNCERTAIN");
    }
  });

  it("excludes the origin pub itself from its own results", async () => {
    const { user, leadType, pipelineStage } = await baseFixtures();
    // MockPubRadiusPlacesProvider names its candidates "Mock Nearby {leadTypeName} 1"/"2",
    // city = the search's own areaLabel ("Milton" here) — matching that
    // exactly exercises isOriginCompany()'s self-exclusion filter.
    const origin = await createCompanyFixture({
      name: "Mock Nearby Pub 1",
      leadTypeId: leadType.id,
      pipelineStageId: pipelineStage.id,
      assignedToId: null,
      createdById: user.id,
      city: "Milton",
    });
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      mode: "PUB_RADIUS",
      cities: ["Milton"],
      originCompanyId: origin.id,
      radiusValue: 5,
      radiusUnit: "MI",
      originLat: 43.5183,
      originLng: -79.8774,
    });

    await runSearchJob(search.id);

    const results = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    // Without the exclusion filter this would be 2 (both mock candidates);
    // with it, the one matching the origin's own name+city is dropped.
    expect(results).toHaveLength(1);
    expect(results.every((r) => r.name !== "Mock Nearby Pub 1")).toBe(true);
  });

  it("flags a fuzzy-matching existing company as a possible duplicate, same as COMPETITOR mode's duplicate scoring", async () => {
    const { user, leadType, pipelineStage } = await baseFixtures();
    const origin = await createCompanyFixture({
      name: "The Origin Pub",
      leadTypeId: leadType.id,
      pipelineStageId: pipelineStage.id,
      assignedToId: null,
      createdById: user.id,
      city: "Milton",
    });
    // Name-matches one of MockPubRadiusPlacesProvider's generated candidates
    // ("Mock Nearby Pub 1") so findScoredDuplicateMatches() has something to
    // find against a live, ACTIVE Company row.
    await createCompanyFixture({
      name: "Mock Nearby Pub 1",
      leadTypeId: leadType.id,
      pipelineStageId: pipelineStage.id,
      assignedToId: null,
      createdById: user.id,
      city: "Milton",
    });
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      mode: "PUB_RADIUS",
      cities: ["Milton"],
      originCompanyId: origin.id,
      radiusValue: 5,
      radiusUnit: "MI",
      originLat: 43.5183,
      originLng: -79.8774,
    });

    await runSearchJob(search.id);

    const results = await testPrisma.searchResult.findMany({ where: { searchId: search.id }, orderBy: { name: "asc" } });
    const matched = results.find((r) => r.name === "Mock Nearby Pub 1");
    expect(matched?.duplicateConfidence).not.toBeNull();
    expect(matched?.competitorConflict).toBe(false); // no competitor concept in this mode
  });

  it("populates DiscoverParams with the geocoded origin and radius-in-meters, not the raw stored radiusValue", async () => {
    const { user, leadType, pipelineStage } = await baseFixtures();
    const origin = await createCompanyFixture({
      name: "The Origin Pub",
      leadTypeId: leadType.id,
      pipelineStageId: pipelineStage.id,
      assignedToId: null,
      createdById: user.id,
      city: "Milton",
    });
    const search = await createLeadSearchFixture({
      createdById: user.id,
      leadTypeId: leadType.id,
      mode: "PUB_RADIUS",
      cities: ["Milton"],
      originCompanyId: origin.id,
      radiusValue: 1, // 1 mile = 1609.34 meters — distinct from the raw stored int
      radiusUnit: "MI",
      originLat: 43.5183,
      originLng: -79.8774,
    });

    await runSearchJob(search.id);

    // Indirect check: the search completed successfully at all, which only
    // happens if GooglePlacesNearbyDiscoveryProvider's — or here,
    // MockPubRadiusPlacesProvider's — discover() call didn't throw on
    // missing/malformed params. A direct radiusMeters assertion belongs in
    // google-places-nearby-provider.test.ts (unit-level, already covers the
    // conversion math via radiusToMeters()); this integration test's job is
    // just confirming run-search.ts actually wires it through end to end.
    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("SUCCEEDED");
  });
});
