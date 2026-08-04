import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createCompetitorFixture, createLeadSearchFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { checkAiBudget, checkMidRunAiBudget } from "../../src/lib/ai/budget";
import { startSearch, retrySearchWithBudgetOverride } from "../../src/app/(dashboard)/leads/searches/actions";
import { startCompetitionLocatorRun } from "../../src/app/(dashboard)/leads/competition-locator/actions";
import { retryCompetitionLocatorRunWithOverride } from "../../src/app/(dashboard)/leads/competition-locator/[runId]/actions";
import { ForbiddenError } from "../../src/lib/auth/permissions";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalProvider = process.env.AI_PROVIDER;

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  mutableEnv.AI_PROVIDER = "anthropic";
  mutableEnv.AI_API_KEY = "sk-test";
  resetEnvCacheForTests();
});

afterEach(() => {
  if (originalProvider === undefined) delete mutableEnv.AI_PROVIDER;
  else mutableEnv.AI_PROVIDER = originalProvider;
  resetEnvCacheForTests();
});

describe("checkAiBudget / checkMidRunAiBudget — overrideSpendLimit", () => {
  it("checkAiBudget: override skips the daily-budget block", async () => {
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 5 } });

    const blocked = await checkAiBudget();
    expect(blocked.allowed).toBe(false);

    const overridden = await checkAiBudget({ overrideSpendLimit: true });
    expect(overridden.allowed).toBe(true);
  });

  it("checkAiBudget: override never bypasses researchEnabled", async () => {
    await testPrisma.aiSettings.create({ data: { id: 1, researchEnabled: false } });

    const overridden = await checkAiBudget({ overrideSpendLimit: true });
    expect(overridden.allowed).toBe(false);
    expect(overridden.reason).toMatch(/disabled/i);
  });

  it("checkMidRunAiBudget: override skips both the daily budget and the per-search ceiling", async () => {
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1, maxCostPerSearchUsd: 0.5 } });
    const role = await createRoleWithPermissions("Administrator", ["run_research"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    await testPrisma.aiUsageRecord.create({ data: { searchId: search.id, provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 5 } });

    const blocked = await checkMidRunAiBudget(search.id);
    expect(blocked.allowed).toBe(false);

    const overridden = await checkMidRunAiBudget(search.id, { overrideSpendLimit: true });
    expect(overridden.allowed).toBe(true);
  });

  it("checkMidRunAiBudget: override never bypasses researchEnabled", async () => {
    await testPrisma.aiSettings.create({ data: { id: 1, researchEnabled: false } });
    const role = await createRoleWithPermissions("Administrator", ["run_research"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });

    const overridden = await checkMidRunAiBudget(search.id, { overrideSpendLimit: true });
    expect(overridden.allowed).toBe(false);
    expect(overridden.reason).toMatch(/disabled/i);
  });
});

function formDataFor(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("startSearch — budget override", () => {
  async function baseFixtures(extraPermissions: string[] = []) {
    const role = await createRoleWithPermissions("Administrator", ["run_research", ...extraPermissions]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture("Pub");
    const prompt = await testPrisma.promptTemplate.create({ data: { name: "Test prompt", qualificationPrompt: "Independently-owned bars.", createdById: user.id } });
    return { user, leadType, prompt };
  }

  it("returns budgetBlocked without manage_ai_settings, even if overrideBudget is requested", async () => {
    const { user, leadType, prompt } = await baseFixtures();
    await loginAs(user.id);
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 5 } });

    const result = await startSearch(undefined, formDataFor({ overrideBudget: "true", promptId: prompt.id, country: "Canada", region: "ON", leadTypeId: leadType.id, mode: "GENERAL", competitorId: "" }));
    expect(result?.budgetBlocked).toBe(true);
  });

  it("creates the search with budgetOverride set when manage_ai_settings approves the override", async () => {
    const { user, leadType, prompt } = await baseFixtures(["manage_ai_settings"]);
    await loginAs(user.id);
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 5 } });

    await expect(
      startSearch(undefined, formDataFor({ overrideBudget: "true", promptId: prompt.id, country: "Canada", region: "ON", leadTypeId: leadType.id, mode: "GENERAL", competitorId: "" })),
    ).rejects.toThrow(); // redirect() throws internally in the test environment

    const search = await testPrisma.leadSearch.findFirstOrThrow({ where: { leadTypeId: leadType.id } });
    expect(search.budgetOverride).toBe(true);

    const audit = await testPrisma.auditEvent.findFirst({ where: { action: "ai_budget.overridden", entityId: search.id } });
    expect(audit).not.toBeNull();
  });
});

describe("retrySearchWithBudgetOverride", () => {
  it("requires manage_ai_settings", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["run_research"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    await testPrisma.leadSearch.update({ where: { id: search.id }, data: { status: "FAILED", errorMessage: "Today's AI research budget has been reached." } });

    await expect(retrySearchWithBudgetOverride(search.id)).rejects.toThrow(ForbiddenError);
  });

  it("only resumes a FAILED search", async () => {
    const role = await createRoleWithPermissions("Administrator", ["run_research", "manage_ai_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    // status defaults to PENDING, not FAILED

    const result = await retrySearchWithBudgetOverride(search.id);
    expect(result.error).toBeTruthy();
  });

  it("sets budgetOverride and re-enqueues a FAILED search", async () => {
    const role = await createRoleWithPermissions("Administrator", ["run_research", "manage_ai_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "TRIVIA_GAP" });
    await testPrisma.leadSearch.update({ where: { id: search.id }, data: { status: "FAILED", errorMessage: "Today's AI research budget has been reached." } });

    const result = await retrySearchWithBudgetOverride(search.id);
    expect(result.error).toBeUndefined();

    const updated = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: search.id } });
    expect(updated.budgetOverride).toBe(true);
    expect(updated.providerJobId).not.toBeNull();

    const audit = await testPrisma.auditEvent.findFirst({ where: { action: "ai_budget.overridden", entityId: search.id } });
    expect(audit).not.toBeNull();
  });
});

describe("startCompetitionLocatorRun — budget override", () => {
  it("sets budgetOverride on every child region search, not just the first", async () => {
    const role = await createRoleWithPermissions("Administrator", ["run_competition_locator", "manage_ai_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const competitor = await createCompetitorFixture("Geeks Who Drink");
    await testPrisma.aiSettings.create({ data: { id: 1, dailyBudgetUsd: 1 } });
    await testPrisma.aiUsageRecord.create({ data: { provider: "anthropic", operation: "discover", model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 5 } });

    const fd = new FormData();
    fd.set("competitorId", competitor.id);
    fd.set("leadTypeId", leadType.id);
    fd.append("regions", "United States|CO");
    fd.append("regions", "Canada|ON");
    fd.set("overrideBudget", "true");

    await expect(startCompetitionLocatorRun(undefined, fd)).rejects.toThrow(); // redirect() throws

    const searches = await testPrisma.leadSearch.findMany({ where: { competitorId: competitor.id } });
    expect(searches).toHaveLength(2);
    expect(searches.every((s) => s.budgetOverride)).toBe(true);
  });
});

describe("retryCompetitionLocatorRunWithOverride", () => {
  it("resumes every FAILED region in the run, not just one", async () => {
    const role = await createRoleWithPermissions("Administrator", ["run_competition_locator", "run_research", "manage_ai_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const competitor = await createCompetitorFixture("Geeks Who Drink");
    const runId = "test-run-override";
    const searchA = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "COMPETITOR", competitorId: competitor.id, runCorrelationId: runId, region: "CO" });
    const searchB = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, mode: "COMPETITOR", competitorId: competitor.id, runCorrelationId: runId, region: "ON" });
    await testPrisma.leadSearch.update({ where: { id: searchA.id }, data: { status: "FAILED", errorMessage: "Today's AI research budget has been reached." } });
    await testPrisma.leadSearch.update({ where: { id: searchB.id }, data: { status: "FAILED", errorMessage: "Today's AI research budget has been reached." } });

    const result = await retryCompetitionLocatorRunWithOverride(runId);
    expect(result.error).toBeUndefined();

    const updatedA = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: searchA.id } });
    const updatedB = await testPrisma.leadSearch.findUniqueOrThrow({ where: { id: searchB.id } });
    expect(updatedA.budgetOverride).toBe(true);
    expect(updatedB.budgetOverride).toBe(true);
  });
});
