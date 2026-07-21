import { describe, it, expect } from "vitest";
import { validateEmailAddress, validateSubject, validateOutgoingEmail } from "../../src/lib/comms/validate";

describe("validateEmailAddress", () => {
  it("accepts a plausible address", () => {
    expect(validateEmailAddress("jane@example.com")).toEqual({ valid: true });
  });

  it("rejects an address missing an @ or domain", () => {
    expect(validateEmailAddress("not-an-email").valid).toBe(false);
    expect(validateEmailAddress("jane@").valid).toBe(false);
  });

  it("rejects an address containing an embedded newline (header injection)", () => {
    const result = validateEmailAddress("jane@example.com\r\nBcc: attacker@evil.test");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/line break/i);
  });

  it("rejects an address containing an embedded carriage return alone", () => {
    expect(validateEmailAddress("jane@example.com\rX-Injected: 1").valid).toBe(false);
  });
});

describe("validateSubject", () => {
  it("accepts a normal subject", () => {
    expect(validateSubject("Following up on our demo")).toEqual({ valid: true });
  });

  it("rejects an empty subject", () => {
    expect(validateSubject("   ").valid).toBe(false);
  });

  it("rejects a subject with an embedded newline", () => {
    const result = validateSubject("Hello\r\nBcc: attacker@evil.test");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/line break/i);
  });
});

describe("validateOutgoingEmail", () => {
  it("passes a well-formed message", () => {
    const result = validateOutgoingEmail({ to: ["jane@example.com"], cc: ["boss@example.com"], subject: "Hi" });
    expect(result).toEqual({ valid: true });
  });

  it("requires at least one recipient", () => {
    const result = validateOutgoingEmail({ to: [], subject: "Hi" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /recipient/i.test(e))).toBe(true);
  });

  it("collects errors from to, cc, bcc, and subject in one pass", () => {
    const result = validateOutgoingEmail({
      to: ["bad-to"],
      cc: ["bad-cc"],
      bcc: ["bad-bcc"],
      subject: "",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it("blocks a header-injection attempt hidden in a bcc address", () => {
    const result = validateOutgoingEmail({
      to: ["jane@example.com"],
      bcc: ["jane@example.com\r\nBcc: everyone@example.com"],
      subject: "Hi",
    });
    expect(result.valid).toBe(false);
  });
});
