import { describe, it, expect, afterEach } from "vitest";
import { captureException } from "../../src/lib/error-reporting";

const mutableEnv = process.env as Record<string, string | undefined>;

afterEach(() => {
  delete mutableEnv.SENTRY_DSN;
});

describe("captureException", () => {
  it("resolves without throwing when SENTRY_DSN is unset (log-only path)", async () => {
    delete mutableEnv.SENTRY_DSN;
    await expect(captureException(new Error("boom"), { context: "test" })).resolves.toBeUndefined();
  });

  it("falls back gracefully when SENTRY_DSN is set but @sentry/node isn't installed", async () => {
    mutableEnv.SENTRY_DSN = "https://example.test/1";
    await expect(captureException(new Error("boom"))).resolves.toBeUndefined();
  });

  it("handles a non-Error value without throwing", async () => {
    await expect(captureException("just a string")).resolves.toBeUndefined();
  });
});
