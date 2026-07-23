import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createLeadSearchFixture,
  createSearchResultFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { researchResult } from "../../src/app/(dashboard)/leads/searches/[id]/results/actions";
import { resetEnvCacheForTests } from "../../src/lib/env";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalProvider = process.env.AI_PROVIDER;

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  mutableEnv.AI_PROVIDER = "mock";
  resetEnvCacheForTests();
});

afterEach(() => {
  if (originalProvider === undefined) delete mutableEnv.AI_PROVIDER;
  else mutableEnv.AI_PROVIDER = originalProvider;
  resetEnvCacheForTests();
});

async function baseFixtures(permissions: string[] = ["run_research"]) {
  const role = await createRoleWithPermissions("Researcher", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  await createPipelineStageFixture("New", { isDefault: true });
  const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "GENERAL", cities: ["Milton"] });
  return { user, leadType, search };
}

describe("researchResult", () => {
  it("requires run_research", async () => {
    const { search } = await baseFixtures([]);
    const noPermRole = await createRoleWithPermissions("NoResearch", ["review_research_results"]);
    const outsider = await createTestUser({ roleId: noPermRole.id });
    await loginAs(outsider.id);

    const result = await createSearchResultFixture({ searchId: search.id });
    await expect(researchResult(result.id)).rejects.toThrow();
  });

  it("returns an error for a nonexistent result", async () => {
    const { user } = await baseFixtures();
    await loginAs(user.id);
    const outcome = await researchResult("not-a-real-id");
    expect(outcome?.error).toBeTruthy();
  });

  it("updates triviaStatus, evidence, sources, score, explanation, and researchedAt from a directory-sourced (UNCERTAIN) result", async () => {
    const { user, search } = await baseFixtures();
    await loginAs(user.id);

    const result = await createSearchResultFixture({
      searchId: search.id,
      triviaStatus: "UNCERTAIN",
      score: 0,
      disposition: "NEW",
      websiteUrl: "https://milton-pub.example.test",
    });
    const before = result.researchedAt;

    const outcome = await researchResult(result.id);
    expect(outcome?.error).toBeUndefined();

    const updated = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect((updated.evidence as unknown[]).length).toBeGreaterThan(0);
    expect((updated.sources as unknown[]).length).toBeGreaterThan(0);
    expect(updated.score).toBeGreaterThan(0);
    expect(updated.researchedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it("never overwrites name/address/phone/email/website even if verify() would change them", async () => {
    const { user, search } = await baseFixtures();
    await loginAs(user.id);

    const result = await createSearchResultFixture({
      searchId: search.id,
      name: "Original Name Pub",
      phone: "555-0001",
      websiteUrl: "https://original.example.test",
    });

    await researchResult(result.id);

    const updated = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(updated.name).toBe("Original Name Pub");
    expect(updated.phone).toBe("555-0001");
    expect(updated.websiteUrl).toBe("https://original.example.test");
  });

  it("recomputes disposition from score vs minimumScore when the result is still NEW/REVIEWED/BELOW_SCORE", async () => {
    const { user, search } = await baseFixtures();
    await loginAs(user.id);

    const result = await createSearchResultFixture({ searchId: search.id, disposition: "NEW", score: 0 });
    await researchResult(result.id);

    const updated = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(["REVIEWED", "BELOW_SCORE"]).toContain(updated.disposition);
  });

  it("never un-rejects an already-REJECTED result", async () => {
    const { user, search } = await baseFixtures();
    await loginAs(user.id);

    const result = await createSearchResultFixture({ searchId: search.id, disposition: "REJECTED", score: 0 });
    await researchResult(result.id);

    const updated = await testPrisma.searchResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(updated.disposition).toBe("REJECTED");
  });

  it("writes an audit event", async () => {
    const { user, search } = await baseFixtures();
    await loginAs(user.id);

    const result = await createSearchResultFixture({ searchId: search.id });
    await researchResult(result.id);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "result.researched", entityId: result.id } });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorId).toBe(user.id);
  });

  it("is rate-limited per user", async () => {
    const { user, search } = await baseFixtures();
    await loginAs(user.id);

    const results = await Promise.all(Array.from({ length: 6 }, () => createSearchResultFixture({ searchId: search.id })));

    const outcomes = [];
    for (const result of results) {
      outcomes.push(await researchResult(result.id));
    }
    expect(outcomes.some((o) => o?.error?.includes("Too many"))).toBe(true);
  });

  it("blocks in anthropic mode once the daily AI budget is reached, same guard as starting a new search", async () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    mutableEnv.AI_API_KEY = "sk-test";
    resetEnvCacheForTests();

    const { user, search } = await baseFixtures();
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1 } });
    await testPrisma.aiUsageRecord.create({
      data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 1000, estimatedCostUsd: 5 },
    });
    await loginAs(user.id);

    const result = await createSearchResultFixture({ searchId: search.id });
    const outcome = await researchResult(result.id);
    expect(outcome?.error).toBeTruthy();
  });
});
