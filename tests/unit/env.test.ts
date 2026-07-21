import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv, resetEnvCacheForTests } from "../../src/lib/env";

const REQUIRED_KEYS = [
  "NODE_ENV",
  "DATABASE_URL",
  "APP_URL",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "AI_PROVIDER",
  "AI_API_KEY",
  "AI_DAILY_BUDGET_USD",
  "AI_MONTHLY_BUDGET_USD",
  "IMPORT_BATCH_TTL_HOURS",
  "SENTRY_DSN",
  "SEED_ADMIN_EMAIL",
  "SEED_ADMIN_PASSWORD",
  "TOKEN_ENCRYPTION_KEY",
  "UNSUBSCRIBE_TOKEN_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of REQUIRED_KEYS) snapshot[key] = process.env[key];
  return snapshot;
}

// process.env.NODE_ENV is typed read-only by @types/node; go through this
// cast for every assignment/delete that might touch it.
const mutableEnv = process.env as Record<string, string | undefined>;

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of REQUIRED_KEYS) {
    if (snapshot[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = snapshot[key];
  }
}

function setNodeEnv(value: string) {
  mutableEnv.NODE_ENV = value;
}

describe("getEnv", () => {
  let snapshot: Record<string, string | undefined>;

  beforeEach(() => {
    snapshot = snapshotEnv();
    resetEnvCacheForTests();
  });

  afterEach(() => {
    restoreEnv(snapshot);
    resetEnvCacheForTests();
  });

  it("parses a minimal valid environment", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const env = getEnv();
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.IMPORT_BATCH_TTL_HOURS).toBe(4);
  });

  it("throws without echoing the value when DATABASE_URL is missing", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");

    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("does not echo a secret value in the error message for an invalid field", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SENTRY_DSN = "super-secret-not-a-url";

    let message = "";
    try {
      getEnv();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("SENTRY_DSN");
    expect(message).not.toContain("super-secret-not-a-url");
  });

  it("requires AI_API_KEY when AI_PROVIDER is anthropic", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.AI_PROVIDER = "anthropic";

    expect(() => getEnv()).toThrow(/AI_API_KEY/);
  });

  it("passes when AI_PROVIDER is anthropic and AI_API_KEY is set", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = "sk-test-key";

    const env = getEnv();
    expect(env.AI_API_KEY).toBe("sk-test-key");
  });

  // Regression: `.env`'s documented "leave blank to skip" convention
  // (AI_API_KEY="") was being rejected outright — a blank string is still a
  // string, so `.optional()` alone didn't treat it as absent, and
  // AI_PROVIDER=mock (which never needs a key) failed to boot with
  // "AI_API_KEY: must not be empty." Mock mode must never require a key.
  it("does NOT require AI_API_KEY when AI_PROVIDER is mock, even if AI_API_KEY is explicitly blank", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.AI_PROVIDER = "mock";
    process.env.AI_API_KEY = "";

    const env = getEnv();
    expect(env.AI_API_KEY).toBeUndefined();
  });

  it("still requires AI_API_KEY when AI_PROVIDER is anthropic, even if AI_API_KEY is explicitly blank rather than unset", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = "";

    expect(() => getEnv()).toThrow(/AI_API_KEY/);
  });

  // The same blank-vs-unset bug applied to every other optional field in
  // this schema (e.g. a blank AI_DAILY_BUDGET_USD would coerce "" -> 0 and
  // fail `.positive()` instead of being treated as "no cap set") — fixed
  // uniformly via the same blankToUndefined preprocessing, spot-checked here.
  it("treats a blank SENTRY_DSN as absent rather than an invalid URL", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SENTRY_DSN = "";

    const env = getEnv();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it("treats a blank AI_DAILY_BUDGET_USD as absent (no cap) rather than coercing to 0 and failing positive()", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.AI_DAILY_BUDGET_USD = "";

    const env = getEnv();
    expect(env.AI_DAILY_BUDGET_USD).toBeUndefined();
  });

  it("rejects an invalid AI_DAILY_BUDGET_USD", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.AI_DAILY_BUDGET_USD = "not-a-number";

    expect(() => getEnv()).toThrow(/AI_DAILY_BUDGET_USD/);
  });

  it("requires SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD to be set together", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SEED_ADMIN_EMAIL = "admin@example.com";

    expect(() => getEnv()).toThrow(/SEED_ADMIN_EMAIL/);
  });

  it("requires APP_URL when NODE_ENV is production", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("production");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = "a-stable-key";

    expect(() => getEnv()).toThrow(/APP_URL/);
  });

  it("requires NEXT_SERVER_ACTIONS_ENCRYPTION_KEY when NODE_ENV is production", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("production");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.APP_URL = "https://crm.example.com";
    process.env.TOKEN_ENCRYPTION_KEY = "a-stable-key";

    expect(() => getEnv()).toThrow(/NEXT_SERVER_ACTIONS_ENCRYPTION_KEY/);
  });

  it("requires TOKEN_ENCRYPTION_KEY when NODE_ENV is production", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("production");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.APP_URL = "https://crm.example.com";
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = "a-stable-key";

    expect(() => getEnv()).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("requires UNSUBSCRIBE_TOKEN_SECRET when NODE_ENV is production", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("production");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.APP_URL = "https://crm.example.com";
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = "a-stable-key";
    process.env.TOKEN_ENCRYPTION_KEY = "a-stable-key";

    expect(() => getEnv()).toThrow(/UNSUBSCRIBE_TOKEN_SECRET/);
  });

  it("requires MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to be set together", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.MICROSOFT_CLIENT_ID = "client-id-only";

    expect(() => getEnv()).toThrow(/MICROSOFT_CLIENT_ID/);
  });

  it("requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to be set together", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.GOOGLE_CLIENT_SECRET = "secret-only";

    expect(() => getEnv()).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("passes a full production-shaped environment", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("production");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.APP_URL = "https://crm.example.com";
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = "a-stable-key";
    process.env.TOKEN_ENCRYPTION_KEY = "a-stable-key";
    process.env.UNSUBSCRIBE_TOKEN_SECRET = "a-stable-key";

    expect(() => getEnv()).not.toThrow();
  });

  it("memoizes the result until resetEnvCacheForTests is called", () => {
    for (const key of REQUIRED_KEYS) delete process.env[key];
    setNodeEnv("test");
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const first = getEnv();
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/other";
    const second = getEnv();
    expect(second).toBe(first);

    resetEnvCacheForTests();
    const third = getEnv();
    expect(third.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/other");
  });
});
