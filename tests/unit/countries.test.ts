import { describe, it, expect } from "vitest";
import { canonicalCountry, countrySpellings, COUNTRY_OPTIONS } from "../../src/lib/constants/countries";

describe("COUNTRY_OPTIONS", () => {
  it("offers Canada and USA, saved as the values the lead searches already use", () => {
    expect(COUNTRY_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ["Canada", "Canada"],
      ["United States", "USA"],
    ]);
  });
});

describe("canonicalCountry", () => {
  it("maps common spellings to the dropdown's values", () => {
    expect(canonicalCountry(" canada ")).toBe("Canada");
    expect(canonicalCountry("CA")).toBe("Canada");
    expect(canonicalCountry("USA")).toBe("United States");
    expect(canonicalCountry("u.s.")).toBe("United States");
    expect(canonicalCountry("United States of America")).toBe("United States");
  });

  it("keeps anything else as-is, and treats empty as empty", () => {
    expect(canonicalCountry("Mexico")).toBe("Mexico");
    expect(canonicalCountry(null)).toBe("");
    expect(canonicalCountry(undefined)).toBe("");
  });
});

describe("countrySpellings", () => {
  it("lets a country filter match every spelling of that country", () => {
    expect(countrySpellings("United States")).toEqual(expect.arrayContaining(["usa", "us", "united states"]));
    expect(countrySpellings("Canada")).toEqual(expect.arrayContaining(["canada", "ca"]));
    expect(countrySpellings(" Mexico ")).toEqual(["Mexico"]);
  });
});
