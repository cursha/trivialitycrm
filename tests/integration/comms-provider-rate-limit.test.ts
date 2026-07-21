import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "../helpers/db";
import { callEmailProvider, EmailProviderRateLimitError } from "../../src/lib/comms/providers/http";

beforeEach(async () => {
  await resetDatabase();
});

describe("callEmailProvider rate limiting", () => {
  it("scopes the rate limit to one connection, not every user of the provider", async () => {
    const options = { providerName: "microsoft", rateLimit: { windowMs: 60_000, limit: 2 } };

    // Connection A exhausts its own budget.
    await callEmailProvider({ ...options, connectionId: "connection-a" }, async () => "ok");
    await callEmailProvider({ ...options, connectionId: "connection-a" }, async () => "ok");
    await expect(callEmailProvider({ ...options, connectionId: "connection-a" }, async () => "ok")).rejects.toThrow(EmailProviderRateLimitError);

    // Connection B on the exact same provider is unaffected — a real gap
    // fixed post-Phase-C: a single shared bucket keyed on providerName
    // alone would have let one connection's exhaustion block another's.
    await expect(callEmailProvider({ ...options, connectionId: "connection-b" }, async () => "ok")).resolves.toBe("ok");
  });

  it("falls back to a shared per-provider bucket when no connectionId is given (non-send calls)", async () => {
    const options = { providerName: "google", rateLimit: { windowMs: 60_000, limit: 1 } };

    await callEmailProvider(options, async () => "ok");
    await expect(callEmailProvider(options, async () => "ok")).rejects.toThrow(EmailProviderRateLimitError);
  });
});
