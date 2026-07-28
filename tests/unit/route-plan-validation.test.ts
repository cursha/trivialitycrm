import { describe, it, expect } from "vitest";
import {
  normalizeCountry,
  formatRouteAddress,
  missingRouteAddressFields,
  isRouteAddressComplete,
  sortRouteCompanies,
  sanitizeRoutePlanSlug,
  buildRoutePlanFilename,
  resolveRouteAddOutcome,
} from "../../src/lib/route-plan/validation";

describe("normalizeCountry", () => {
  it("compares case- and whitespace-insensitively", () => {
    expect(normalizeCountry("Canada")).toBe(normalizeCountry(" canada "));
    expect(normalizeCountry("CA")).toBe(normalizeCountry("ca"));
    expect(normalizeCountry("USA")).not.toBe(normalizeCountry("CA"));
  });
});

describe("formatRouteAddress", () => {
  it("joins street, city, region, postal code with all fields present", () => {
    expect(formatRouteAddress({ address1: "201 Main Street East", city: "Milton", region: "ON", postalCode: "L9T 1N7" })).toBe(
      "201 Main Street East, Milton, ON, L9T 1N7",
    );
  });

  it("omits missing components rather than producing empty/repeated commas", () => {
    expect(formatRouteAddress({ address1: null, city: "Milton", region: "ON", postalCode: null })).toBe("Milton, ON");
    expect(formatRouteAddress({ address1: null, city: "Milton", region: "ON", postalCode: "L9T 1N7" })).toBe("Milton, ON, L9T 1N7");
  });

  it("normalizes an embedded line break in a component to a single space", () => {
    expect(formatRouteAddress({ address1: "201 Main St\nSuite 4", city: "Milton", region: "ON", postalCode: "L9T 1N7" })).toBe(
      "201 Main St Suite 4, Milton, ON, L9T 1N7",
    );
    expect(formatRouteAddress({ address1: "201 Main St\r\n\r\nSuite 4", city: "Milton", region: "ON", postalCode: null })).toBe("201 Main St Suite 4, Milton, ON");
  });

  it("trims whitespace on every component and never emits null/undefined text", () => {
    expect(formatRouteAddress({ address1: "  201 Main St  ", city: " Milton ", region: " ON ", postalCode: "  " })).toBe("201 Main St, Milton, ON");
    const result = formatRouteAddress({ address1: null, city: "Milton", region: "ON", postalCode: null });
    expect(result).not.toContain("null");
    expect(result).not.toContain("undefined");
  });
});

describe("missingRouteAddressFields / isRouteAddressComplete", () => {
  it("reports nothing missing when address1 and postalCode are both present", () => {
    expect(missingRouteAddressFields({ address1: "201 Main St", city: "Milton", region: "ON", postalCode: "L9T 1N7" })).toEqual([]);
    expect(isRouteAddressComplete({ address1: "201 Main St", city: "Milton", region: "ON", postalCode: "L9T 1N7" })).toBe(true);
  });

  it("identifies street address and postal/ZIP as the only fields that can be missing", () => {
    expect(missingRouteAddressFields({ address1: null, city: "Milton", region: "ON", postalCode: null })).toEqual(["street address", "postal/ZIP code"]);
    expect(missingRouteAddressFields({ address1: null, city: "Milton", region: "ON", postalCode: "L9T 1N7" })).toEqual(["street address"]);
    expect(missingRouteAddressFields({ address1: "201 Main St", city: "Milton", region: "ON", postalCode: null })).toEqual(["postal/ZIP code"]);
    expect(isRouteAddressComplete({ address1: null, city: "Milton", region: "ON", postalCode: null })).toBe(false);
  });

  it("treats whitespace-only values as missing, not present", () => {
    expect(missingRouteAddressFields({ address1: "   ", city: "Milton", region: "ON", postalCode: "L9T 1N7" })).toEqual(["street address"]);
  });
});

describe("sortRouteCompanies", () => {
  it("sorts case-insensitively by name", () => {
    const companies = [
      { id: "1", name: "the Ivy Arms" },
      { id: "2", name: "Bryden's" },
      { id: "3", name: "Ned Devine's" },
    ];
    expect(sortRouteCompanies(companies).map((c) => c.name)).toEqual(["Bryden's", "Ned Devine's", "the Ivy Arms"]);
  });

  it("uses company id as a stable secondary sort for identical names", () => {
    const companies = [
      { id: "b", name: "Same Name" },
      { id: "a", name: "Same Name" },
    ];
    expect(sortRouteCompanies(companies).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const companies = [
      { id: "2", name: "Zed" },
      { id: "1", name: "Alpha" },
    ];
    const copy = [...companies];
    sortRouteCompanies(companies);
    expect(companies).toEqual(copy);
  });
});

describe("sanitizeRoutePlanSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(sanitizeRoutePlanSlug("Senior Home")).toBe("senior-home");
    expect(sanitizeRoutePlanSlug("Pub")).toBe("pub");
  });

  it("collapses repeated separators and strips leading/trailing hyphens", () => {
    expect(sanitizeRoutePlanSlug("  Pub & Trivia!! ")).toBe("pub-trivia");
    expect(sanitizeRoutePlanSlug("--edge--")).toBe("edge");
  });
});

describe("buildRoutePlanFilename", () => {
  it("builds <slug>-route-YYYY-MM-DD.csv with zero-padded month/day and no time", () => {
    expect(buildRoutePlanFilename("pub", { year: 2026, month: 7, day: 28 })).toBe("pub-route-2026-07-28.csv");
    expect(buildRoutePlanFilename("senior-home", { year: 2026, month: 1, day: 5 })).toBe("senior-home-route-2026-01-05.csv");
  });
});

describe("resolveRouteAddOutcome", () => {
  const eligible = { leadTypeId: "lt-pub", country: "Canada", leadTypeRoutePlanEnabled: true };

  it("rejects an ineligible lead type as the first failure, regardless of route state", () => {
    const ineligible = { leadTypeId: "lt-other", country: "Canada", leadTypeRoutePlanEnabled: false };
    expect(resolveRouteAddOutcome({ leadTypeId: null, country: null }, ineligible)).toEqual({ type: "ineligible" });
    expect(resolveRouteAddOutcome({ leadTypeId: "lt-pub", country: "Canada" }, ineligible)).toEqual({ type: "ineligible" });
  });

  it("accepts an eligible company into an empty route (establishing it)", () => {
    expect(resolveRouteAddOutcome({ leadTypeId: null, country: null }, eligible)).toEqual({ type: "ok" });
  });

  it("accepts a matching lead type and country (case/whitespace-insensitive)", () => {
    expect(resolveRouteAddOutcome({ leadTypeId: "lt-pub", country: " canada " }, eligible)).toEqual({ type: "ok" });
  });

  it("flags a lead-type conflict", () => {
    expect(resolveRouteAddOutcome({ leadTypeId: "lt-senior-home", country: "Canada" }, eligible)).toEqual({ type: "lead_type_conflict" });
  });

  it("flags a country conflict only when the lead type already matches", () => {
    expect(resolveRouteAddOutcome({ leadTypeId: "lt-pub", country: "USA" }, eligible)).toEqual({ type: "country_conflict" });
  });

  it("checks lead type before country when both differ", () => {
    expect(resolveRouteAddOutcome({ leadTypeId: "lt-senior-home", country: "USA" }, eligible)).toEqual({ type: "lead_type_conflict" });
  });
});
