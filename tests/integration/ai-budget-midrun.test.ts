import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createLeadSearchFixture } from "../helpers/fixtures";
import { resetEnvCacheForTests } from "../../src/lib/env";
import * as budgetModule from "../../src/lib/ai/budget";
import { checkMidRunAiBudget } from "../../src/lib/ai/budget";
import { runSearchJob } from "../../src/lib/research/run-search";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalProvider = process.env.AI_PROVIDER;

beforeEach(async () => {
  await resetDatabase();
  mutableEnv.AI_PROVIDER = "mock";
  resetEnvCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalProvider === undefined) delete mutableEnv.AI_PROVIDER;
  else mutableEnv.AI_PROVIDER = originalProvider;
  resetEnvCacheForTests();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["run_research", "review_research_results"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  return { user, leadType };
}

describe("checkMidRunAiBudget (direct)", () => {
  it("is always allowed in mock mode, regardless of spend", async () => {
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 999 } });
    const result = await checkMidRunAiBudget("some-search-id");
    expect(result.allowed).toBe(true);
  });

  it("is blocked once the daily budget is crossed, in anthropic mode", async () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    mutableEnv.AI_API_KEY = "sk-test";
    resetEnvCacheForTests();
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 5 } });

    const result = await checkMidRunAiBudget("some-search-id");
    expect(result.allowed).toBe(false);
  });

  it("is blocked once this search's own maxCostPerSearchUsd is crossed, even under the daily budget", async () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    mutableEnv.AI_API_KEY = "sk-test";
    resetEnvCacheForTests();
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1000, maxCostPerSearchUsd: 1 } });
    const { user, leadType } = await baseFixtures();
    const thisSearch = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    const otherSearch = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });

    // Spend on a DIFFERENT search must not count against this one's cap.
    await testPrisma.aiUsageRecord.create({ data: { searchId: otherSearch.id, provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 5 } });
    const stillUnderCap = await checkMidRunAiBudget(thisSearch.id);
    expect(stillUnderCap.allowed).toBe(true);

    await testPrisma.aiUsageRecord.create({ data: { searchId: thisSearch.id, provider: "anthropic", operation: "verify", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 1.5 } });
    const overCap = await checkMidRunAiBudget(thisSearch.id);
    expect(overCap.allowed).toBe(false);
    expect(overCap.reason).toMatch(/per-search/i);
  });

  it("is unaffected by maxCostPerSearchUsd when it's null (unlimited, the default)", async () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    mutableEnv.AI_API_KEY = "sk-test";
    resetEnvCacheForTests();
    await testPrisma.aiSettings.create({ data: { id: 1, maxCostPerSearchUsd: null } });
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    await testPrisma.aiUsageRecord.create({ data: { searchId: search.id, provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 999 } });

    const result = await checkMidRunAiBudget(search.id);
    expect(result.allowed).toBe(true);
  });
});

describe("runSearchJob — mid-run budget stop (spied)", () => {
  it("stops safely between candidates when the mid-run recheck says no, without a duplicate charge or an extra result, and audits the block", async () => {
    const { user, leadType } = await baseFixtures();
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, cities: ["Milton", "Oakville"], mode: "TRIVIA_GAP" });

    const budgetSpy = vi.spyOn(budgetModule, "checkMidRunAiBudget").mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, reason: "Today's AI research budget has been reached." });

    await runSearchJob(search.id);

    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.errorMessage).toMatch(/budget/i);

    // First candidate completed (its result exists); the second was never
    // reached — no partial/duplicate SearchResult for it.
    const results = await testPrisma.searchResult.findMany({ where: { searchId: search.id } });
    expect(results).toHaveLength(1);

    const candidates = await testPrisma.searchCandidate.findMany({ where: { searchId: search.id }, orderBy: { index: "asc" } });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].status).toBe("COMPLETED");
    expect(candidates[1].status).toBe("PENDING"); // never even started

    const audit = await testPrisma.auditEvent.findFirst({ where: { action: "ai_search.budget_blocked", entityId: search.id } });
    expect(audit).not.toBeNull();
    expect(audit?.success).toBe(false);

    budgetSpy.mockRestore();
  }, 20000);
});
