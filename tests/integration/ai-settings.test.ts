import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { updateAiSettings } from "../../src/app/(dashboard)/administration/ai-settings/actions";
import { getAiSettings, isAiApiKeyConfigured } from "../../src/lib/ai/budget";
import { getEnv, resetEnvCacheForTests } from "../../src/lib/env";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalProvider = process.env.AI_PROVIDER;
const originalApiKey = process.env.AI_API_KEY;

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  resetEnvCacheForTests();
});

afterEach(() => {
  if (originalProvider === undefined) delete mutableEnv.AI_PROVIDER;
  else mutableEnv.AI_PROVIDER = originalProvider;
  if (originalApiKey === undefined) delete mutableEnv.AI_API_KEY;
  else mutableEnv.AI_API_KEY = originalApiKey;
  resetEnvCacheForTests();
});

function formData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    researchEnabled: "on",
    approvedModel: "claude-sonnet-5",
    defaultMinimumScore: "80",
    maxCitiesPerSearch: "50",
  };
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) fd.set(k, v);
  return fd;
}

describe("AI settings", () => {
  it("requires manage_ai_settings", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(updateAiSettings(undefined, formData())).rejects.toThrow();
  });

  it("rejects an unapproved model", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_ai_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await updateAiSettings(undefined, formData({ approvedModel: "gpt-5" }));
    expect(result?.error).toBeTruthy();
  });

  it("rejects a maxCitiesPerSearch above the app's own 50-city ceiling", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_ai_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await updateAiSettings(undefined, formData({ maxCitiesPerSearch: "100" }));
    expect(result?.error).toBeTruthy();
  });

  it("saves valid settings and audits the change", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_ai_settings"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await updateAiSettings(undefined, formData({ dailyBudgetUsd: "5.00" }));

    const settings = await getAiSettings();
    expect(settings.dailyBudgetUsd).toBe(5);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "ai_settings.updated" } });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorId).toBe(user.id);
  });

  it("mock mode never requires an API key", () => {
    mutableEnv.AI_PROVIDER = "mock";
    delete mutableEnv.AI_API_KEY;
    resetEnvCacheForTests();

    expect(isAiApiKeyConfigured()).toBe(false);
    expect(() => getEnv()).not.toThrow();
  });

  it("anthropic mode requires a configured key — getEnv() itself refuses to boot without one", () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    delete mutableEnv.AI_API_KEY;
    resetEnvCacheForTests();

    expect(() => getEnv()).toThrow(/AI_API_KEY/);
  });

  it("reports only a configured boolean, never the raw key value", () => {
    mutableEnv.AI_PROVIDER = "anthropic";
    mutableEnv.AI_API_KEY = "sk-super-secret-value";
    resetEnvCacheForTests();

    expect(isAiApiKeyConfigured()).toBe(true);
    // getEnv() itself still returns the real value internally (needed to
    // actually call the provider) — isAiApiKeyConfigured() is the one
    // sanctioned way anything UI-facing may ever ask about it.
    expect(getEnv().AI_API_KEY).toBe("sk-super-secret-value");
  });
});
