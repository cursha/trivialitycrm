import { describe, it, expect } from "vitest";
import {
  normalizePersonName,
  normalizeCity,
  normalizeRegion,
  normalizePostalCode,
  computeAddressNormalizedFields,
  computeContactNormalizedFields,
} from "../../src/lib/data-quality/normalize";

describe("normalizePersonName", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizePersonName("O'Brien")).toBe("obrien");
    expect(normalizePersonName("  Mary-Jane ")).toBe("mary jane");
  });
});

describe("normalizeCity", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeCity("  Saint   John's ")).toBe("saint johns");
  });
});

describe("normalizeRegion", () => {
  it("maps a full US state name or abbreviation to the canonical code", () => {
    expect(normalizeRegion("California", "United States")).toBe("CA");
    expect(normalizeRegion("ca", "US")).toBe("CA");
    expect(normalizeRegion("CA", "USA")).toBe("CA");
  });

  it("maps a full Canadian province name or abbreviation to the canonical code", () => {
    expect(normalizeRegion("Ontario", "Canada")).toBe("ON");
    expect(normalizeRegion("on", "CA")).toBe("ON");
  });

  it("falls back to a trimmed, lowercased passthrough for an unrecognized region/country combination", () => {
    expect(normalizeRegion("Bavaria", "Germany")).toBe("bavaria");
  });
});

describe("normalizePostalCode", () => {
  it("normalizes a 5-digit US ZIP and a ZIP+4", () => {
    expect(normalizePostalCode("90210", "United States")).toBe("90210");
    expect(normalizePostalCode("90210-1234", "US")).toBe("90210-1234");
    expect(normalizePostalCode("902101234", "US")).toBe("90210-1234");
  });

  it("normalizes a Canadian postal code regardless of spacing/case", () => {
    expect(normalizePostalCode("m5v3a8", "Canada")).toBe("M5V 3A8");
    expect(normalizePostalCode("M5V 3A8", "CA")).toBe("M5V 3A8");
  });

  it("returns null for a code that doesn't match the expected format for its country", () => {
    expect(normalizePostalCode("not-a-zip", "United States")).toBeNull();
    expect(normalizePostalCode("12345", "Canada")).toBeNull();
  });

  it("returns null for a country it doesn't recognize as US/Canada, rather than guessing", () => {
    expect(normalizePostalCode("SW1A 1AA", "United Kingdom")).toBeNull();
  });
});

describe("computeAddressNormalizedFields", () => {
  it("computes all three fields without touching the original display values", () => {
    const result = computeAddressNormalizedFields({
      city: "Toronto",
      region: "Ontario",
      postalCode: "m5v 3a8",
      country: "Canada",
    });
    expect(result).toEqual({ normalizedCity: "toronto", normalizedRegion: "ON", normalizedPostalCode: "M5V 3A8" });
  });

  it("returns nulls for absent fields, never inventing a value", () => {
    expect(computeAddressNormalizedFields({})).toEqual({ normalizedCity: null, normalizedRegion: null, normalizedPostalCode: null });
  });
});

describe("computeContactNormalizedFields", () => {
  it("normalizes name/phone/email consistently", () => {
    const result = computeContactNormalizedFields({ firstName: "Mary-Jane", lastName: "O'Brien", phone: "(905) 555-0134", email: " Test@Example.COM " });
    expect(result).toEqual({
      normalizedFirstName: "mary jane",
      normalizedLastName: "obrien",
      normalizedPhone: "9055550134",
      normalizedEmail: "test@example.com",
    });
  });
});
