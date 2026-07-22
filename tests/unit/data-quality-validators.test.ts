import { describe, it, expect } from "vitest";
import { isValidEmailFormat, isValidNorthAmericanPhone, isValidUrl } from "../../src/lib/data-quality/validators";

describe("isValidEmailFormat", () => {
  it("accepts a well-formed email", () => {
    expect(isValidEmailFormat("sales@thecopperkettle.com").valid).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(isValidEmailFormat("not-an-email").valid).toBe(false);
    expect(isValidEmailFormat("missing@domain").valid).toBe(false);
    expect(isValidEmailFormat("double..dot@example.com").valid).toBe(false);
  });

  it("flags a known placeholder domain as invalid", () => {
    const result = isValidEmailFormat("test@example.com");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/placeholder/i);
  });
});

describe("isValidNorthAmericanPhone", () => {
  it("accepts a well-formed 10-digit number regardless of formatting", () => {
    expect(isValidNorthAmericanPhone("(905) 555-0134").valid).toBe(true);
    expect(isValidNorthAmericanPhone("19055550134").valid).toBe(true);
  });

  it("rejects a number with the wrong digit count", () => {
    expect(isValidNorthAmericanPhone("12345").valid).toBe(false);
  });

  it("rejects an all-same-digit placeholder number", () => {
    expect(isValidNorthAmericanPhone("555-555-5555").valid).toBe(false);
    expect(isValidNorthAmericanPhone("5555555555").valid).toBe(false);
  });

  it("rejects a number with an invalid area code", () => {
    expect(isValidNorthAmericanPhone("0555550134").valid).toBe(false);
  });
});

describe("isValidUrl", () => {
  it("accepts a well-formed URL with or without a scheme", () => {
    expect(isValidUrl("https://www.thecopperkettle.com").valid).toBe(true);
    expect(isValidUrl("thecopperkettle.com").valid).toBe(true);
  });

  it("rejects an unparsable URL", () => {
    expect(isValidUrl("not a url::::").valid).toBe(false);
  });

  it("rejects a bare IP address", () => {
    expect(isValidUrl("http://192.168.1.1").valid).toBe(false);
  });

  it("rejects a known placeholder domain", () => {
    expect(isValidUrl("http://example.com").valid).toBe(false);
  });
});
