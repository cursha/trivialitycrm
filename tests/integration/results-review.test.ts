import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createLeadSearchFixture, createSearchResultFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { rejectResult, restoreResult, markReviewed } from "../../src/app/(dashboard)/leads/searches/[id]/results/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const reviewerRole = await createRoleWithPermissions("Reviewer", ["review_research_results"]);
  const restorerRole = await createRoleWithPermissions("Restorer", ["review_research_results", "restore_rejected"]);
  const reviewer = await createTestUser({ name: "Reviewer", roleId: reviewerRole.id });
  const restorer = await createTestUser({ name: "Restorer", roleId: restorerRole.id });
  const leadType = await createLeadTypeFixture("Pub");
  const search = await createLeadSearchFixture({ createdById: reviewer.id, leadTypeId: leadType.id, minimumScore: 80 });
  const reason = await testPrisma.rejectionReason.create({ data: { name: "Already Has Trivia" } });
  return { reviewer, restorer, leadType, search, reason };
}

describe("results review actions", () => {
  it("rejects a result with a reason", async () => {
    const { reviewer, search, reason } = await baseFixtures();
    await loginAs(reviewer.id);
    const result = await createSearchResultFixture({ searchId: search.id, disposition: "NEW" });

    await rejectResult(result.id, reason.id);

    const updated = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(updated.disposition).toBe("REJECTED");
    expect(updated.rejectionReasonId).toBe(reason.id);
  });

  it("blocks restore without restore_rejected", async () => {
    const { reviewer, search, reason } = await baseFixtures();
    await loginAs(reviewer.id);
    const result = await createSearchResultFixture({ searchId: search.id, disposition: "REJECTED", rejectionReasonId: reason.id, score: 90 });

    await expect(restoreResult(result.id)).rejects.toThrow(/Forbidden/);
  });

  it("restores a rejected result back above minimum score to REVIEWED", async () => {
    const { restorer, search, reason } = await baseFixtures();
    await loginAs(restorer.id);
    const result = await createSearchResultFixture({ searchId: search.id, disposition: "REJECTED", rejectionReasonId: reason.id, score: 90 });

    await restoreResult(result.id);

    const updated = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(updated.disposition).toBe("REVIEWED");
    expect(updated.rejectionReasonId).toBeNull();
  });

  it("restores a below-minimum-score result to BELOW_SCORE, not NEW", async () => {
    const { restorer, search, reason } = await baseFixtures();
    await loginAs(restorer.id);
    const result = await createSearchResultFixture({ searchId: search.id, disposition: "REJECTED", rejectionReasonId: reason.id, score: 50 });

    await restoreResult(result.id);

    const updated = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(updated.disposition).toBe("BELOW_SCORE");
  });

  it("marks a NEW result REVIEWED", async () => {
    const { reviewer, search } = await baseFixtures();
    await loginAs(reviewer.id);
    const result = await createSearchResultFixture({ searchId: search.id, disposition: "NEW" });

    await markReviewed(result.id);

    expect((await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } })).disposition).toBe("REVIEWED");
  });
});
