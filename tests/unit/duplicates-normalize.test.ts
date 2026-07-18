import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName,
  normalizePhone,
  normalizeEmail,
  extractWebsiteDomain,
  normalizeAddressLine,
} from "../../src/lib/duplicates/normalize";

describe("normalizeCompanyName", () => {
  it("lowercases, strips common suffixes, and collapses punctuation/whitespace", () => {
    expect(normalizeCompanyName("The Copper Kettle, Inc.")).toBe("the copper kettle");
    expect(normalizeCompanyName("Stonehouse Tavern LLC")).toBe("stonehouse tavern");
    expect(normalizeCompanyName("  Local   Tap ")).toBe("local tap");
  });

  it("treats differently-punctuated variants of the same name as equal", () => {
    expect(normalizeCompanyName("O'Malley's Pub")).toBe(normalizeCompanyName("OMalleys Pub"));
  });
});

describe("normalizePhone", () => {
  it("strips formatting down to digits", () => {
    expect(normalizePhone("(905) 555-0134")).toBe("9055550134");
    expect(normalizePhone("905.555.0134")).toBe("9055550134");
  });

  it("rejects strings too short to be a real phone number", () => {
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Sales@Example.COM ")).toBe("sales@example.com");
  });
});

describe("extractWebsiteDomain", () => {
  it("extracts a bare lowercase hostname, dropping scheme, path, and www", () => {
    expect(extractWebsiteDomain("https://www.Example.com/menu")).toBe("example.com");
    expect(extractWebsiteDomain("example.com")).toBe("example.com");
  });

  it("returns null for an unparsable URL", () => {
    expect(extractWebsiteDomain("not a url::::")).toBeNull();
  });
});

describe("normalizeAddressLine", () => {
  it("normalizes common street-type abbreviations", () => {
    expect(normalizeAddressLine("123 Main Street")).toBe(normalizeAddressLine("123 Main St"));
    expect(normalizeAddressLine("456 Oak Avenue, Suite 2")).toBe(normalizeAddressLine("456 Oak Ave Ste 2"));
  });
});
