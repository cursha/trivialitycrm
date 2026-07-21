import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken } from "../../src/lib/comms/token-crypto";
import { resetEnvCacheForTests } from "../../src/lib/env";

// Test-only fixture key — never used outside this test file, not a real secret.
const TEST_KEY = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const OTHER_KEY = "b3RoZXJrZXlvdGhlcmtleW90aGVya2V5b3RoZXJrZXk=";

const mutableEnv = process.env as Record<string, string | undefined>;

describe("token-crypto", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = mutableEnv.TOKEN_ENCRYPTION_KEY;
    mutableEnv.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    resetEnvCacheForTests();
  });

  afterEach(() => {
    if (savedKey === undefined) delete mutableEnv.TOKEN_ENCRYPTION_KEY;
    else mutableEnv.TOKEN_ENCRYPTION_KEY = savedKey;
    resetEnvCacheForTests();
  });

  it("round-trips a plaintext token", () => {
    const encrypted = encryptToken("a-real-oauth-refresh-token-value");
    expect(encrypted).not.toContain("a-real-oauth-refresh-token-value");
    expect(decryptToken(encrypted)).toBe("a-real-oauth-refresh-token-value");
  });

  it("produces a different ciphertext each time (random IV), same plaintext", () => {
    const first = encryptToken("same-token");
    const second = encryptToken("same-token");
    expect(first).not.toBe(second);
    expect(decryptToken(first)).toBe("same-token");
    expect(decryptToken(second)).toBe("same-token");
  });

  it("throws rather than returning garbage when the ciphertext is tampered with", () => {
    const encrypted = encryptToken("sensitive-value");
    const [iv, authTag, ciphertext] = encrypted.split(".");
    // Flip the last character of the ciphertext segment.
    const tamperedChar = ciphertext.at(-1) === "A" ? "B" : "A";
    const tampered = [iv, authTag, ciphertext.slice(0, -1) + tamperedChar].join(".");

    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws when decrypting with the wrong key", () => {
    const encrypted = encryptToken("sensitive-value");
    mutableEnv.TOKEN_ENCRYPTION_KEY = OTHER_KEY;
    resetEnvCacheForTests();

    expect(() => decryptToken(encrypted)).toThrow();
  });

  it("throws on a malformed (non 3-part) encoded value", () => {
    expect(() => decryptToken("not-a-valid-encoded-token")).toThrow(/Malformed/);
  });

  it("throws a clear error when TOKEN_ENCRYPTION_KEY is not configured", () => {
    delete mutableEnv.TOKEN_ENCRYPTION_KEY;
    resetEnvCacheForTests();

    expect(() => encryptToken("value")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});
