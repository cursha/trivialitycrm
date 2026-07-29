import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPromptTemplateFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies, RedirectSignal } from "../setup/mock-next";
import { startSearch } from "../../src/app/(dashboard)/leads/searches/actions";
import { resetEnvCacheForTests } from "../../src/lib/env";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalProvider = process.env.AI_PROVIDER;

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

afterEach(() => {
  if (originalProvider === undefined) delete mutableEnv.AI_PROVIDER;
  else mutableEnv.AI_PROVIDER = originalProvider;
  resetEnvCacheForTests();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["run_research"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const prompt = await createPromptTemplateFixture({ createdById: user.id });
  return { user, leadType, prompt };
}

function searchFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = { country: "Canada", region: "ON", mode: "GENERAL" };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) fd.set(k, v);
  return fd;
}

describe("AI budget enforcement in startSearch", () => {
  it("never blocks mock mode even with a zero daily budget", async () => {
    mutableEnv.AI_PROVIDER = "mock";
    resetEnvCacheForTests();
    const { user, leadType, prompt } = await baseFixtures();
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 0.01 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 1000, estimatedCostUsd: 5 } });
    await loginAs(user.id);

    let redirected = false;
    try {
      await startSearch(undefined, searchFormData({ promptId: prompt.id, leadTypeId: leadType.id }));
    } catch (error) {
      redirected = (error as RedirectSignal).url !== undefined;
    }
    expect(redirected).toBe(true);
  });

  it("blocks a new search once the daily budget is reached (anthropic mode)", async () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    mutableEnv.AI_API_KEY = "sk-test";
    resetEnvCacheForTests();
    const { user, leadType, prompt } = await baseFixtures();
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 1000, estimatedCostUsd: 1.5 } });
    await loginAs(user.id);

    const result = await startSearch(undefined, searchFormData({ promptId: prompt.id, leadTypeId: leadType.id }));
    expect(result?.error).toMatch(/budget/i);
    expect(await testPrisma.leadSearch.count()).toBe(0);

    delete mutableEnv.AI_API_KEY;
  });

  it("blocks a new search once the monthly budget is reached (anthropic mode)", async () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    mutableEnv.AI_API_KEY = "sk-test";
    resetEnvCacheForTests();
    const { user, leadType, prompt } = await baseFixtures();
    await testPrisma.aiSettings.create({ data: { id: 1, monthlyBudgetUsd: 10 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 1000, estimatedCostUsd: 12 } });
    await loginAs(user.id);

    const result = await startSearch(undefined, searchFormData({ promptId: prompt.id, leadTypeId: leadType.id }));
    expect(result?.error).toMatch(/month/i);

    delete mutableEnv.AI_API_KEY;
  });

  it("blocks a new search when AI research is disabled by an administrator", async () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    mutableEnv.AI_API_KEY = "sk-test";
    resetEnvCacheForTests();
    const { user, leadType, prompt } = await baseFixtures();
    await testPrisma.aiSettings.create({ data: { id: 1, researchEnabled: false } });
    await loginAs(user.id);

    const result = await startSearch(undefined, searchFormData({ promptId: prompt.id, leadTypeId: leadType.id }));
    expect(result?.error).toMatch(/disabled/i);

    delete mutableEnv.AI_API_KEY;
  });

  it("rejects more cities than the administrator-configured maximum", async () => {
    mutableEnv.AI_PROVIDER = "mock";
    resetEnvCacheForTests();
    const { user, leadType, prompt } = await baseFixtures();
    await testPrisma.aiSettings.create({ data: { id: 1, maxCitiesPerSearch: 2 } });
    await loginAs(user.id);

    const fd = searchFormData({ promptId: prompt.id, leadTypeId: leadType.id });
    fd.append("cities", "Toronto");
    fd.append("cities", "Ottawa");
    fd.append("cities", "Hamilton");

    const result = await startSearch(undefined, fd);
    expect(result?.error).toMatch(/2 cities/);
  });
});
