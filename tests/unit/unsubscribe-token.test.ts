import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../../src/lib/comms/unsubscribe-token";
import { resetEnvCacheForTests } from "../../src/lib/env";

const TEST_SECRET = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const OTHER_SECRET = "b3RoZXJrZXlvdGhlcmtleW90aGVya2V5b3RoZXJrZXk=";
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(() => {
  mutableEnv.UNSUBSCRIBE_TOKEN_SECRET = TEST_SECRET;
  resetEnvCacheForTests();
});

afterEach(() => {
  delete mutableEnv.UNSUBSCRIBE_TOKEN_SECRET;
  resetEnvCacheForTests();
  vi.useRealTimers();
});

describe("unsubscribe-token", () => {
  it("round-trips a contact id", () => {
    const token = createUnsubscribeToken("contact-123");
    expect(verifyUnsubscribeToken(token)).toEqual({ contactId: "contact-123" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = createUnsubscribeToken("contact-123");
    mutableEnv.UNSUBSCRIBE_TOKEN_SECRET = OTHER_SECRET;
    resetEnvCacheForTests();
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = createUnsubscribeToken("contact-123");
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ contactId: "someone-elses-contact", exp: Date.now() + 1000000 }), "utf8").toString(
      "base64url",
    );
    expect(verifyUnsubscribeToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifyUnsubscribeToken("not-a-valid-token")).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createUnsubscribeToken("contact-123");

    vi.setSystemTime(new Date("2028-01-01T00:00:00.000Z"));
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("throws a clear error when UNSUBSCRIBE_TOKEN_SECRET is not configured", () => {
    delete mutableEnv.UNSUBSCRIBE_TOKEN_SECRET;
    resetEnvCacheForTests();
    expect(() => createUnsubscribeToken("contact-123")).toThrow(/UNSUBSCRIBE_TOKEN_SECRET/);
  });
});
