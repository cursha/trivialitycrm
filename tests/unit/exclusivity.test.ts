import { describe, it, expect } from "vitest";
import { filterByModeExclusivity, dedupeWithinRun } from "../../src/lib/research/exclusivity";
import type { ResearchCandidate } from "../../src/lib/research/providers/types";

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    name: "The Copper Kettle",
    address1: null,
    city: "Milton",
    region: "ON",
    postalCode: null,
    country: "Canada",
    phone: null,
    email: null,
    websiteUrl: null,
    contactData: null,
    triviaStatus: "UNCERTAIN",
    competitorName: null,
    evidence: [],
    sources: [],
    ...overrides,
  };
}

describe("filterByModeExclusivity", () => {
  it("drops CURRENT_TRIVIA candidates from a TRIVIA_GAP search", () => {
    const candidates = [candidate({ triviaStatus: "UNCERTAIN" }), candidate({ name: "Has Trivia Bar", triviaStatus: "CURRENT_TRIVIA" })];
    const result = filterByModeExclusivity(candidates, "TRIVIA_GAP");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("The Copper Kettle");
  });

  it("keeps only positively-confirmed candidates for TRIVIA_CONFIRMED", () => {
    const candidates = [
      candidate({ triviaStatus: "UNCERTAIN" }),
      candidate({ name: "No Trivia Bar", triviaStatus: "NO_CURRENT_TRIVIA" }),
      candidate({ name: "Confirmed Trivia Bar", triviaStatus: "CURRENT_TRIVIA" }),
    ];
    const result = filterByModeExclusivity(candidates, "TRIVIA_CONFIRMED");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Confirmed Trivia Bar");
  });

  it("never lets the same location satisfy both mode filters", () => {
    const candidates = [candidate({ triviaStatus: "CURRENT_TRIVIA" })];
    const gapResult = filterByModeExclusivity(candidates, "TRIVIA_GAP").map((c) => c.name);
    const confirmedResult = filterByModeExclusivity(candidates, "TRIVIA_CONFIRMED").map((c) => c.name);
    const overlap = gapResult.filter((name) => confirmedResult.includes(name));
    expect(overlap).toHaveLength(0);
  });

  it("passes everything through for GENERAL and COMPETITOR modes", () => {
    const candidates = [candidate({ triviaStatus: "CURRENT_TRIVIA" }), candidate({ name: "B", triviaStatus: "UNCERTAIN" })];
    expect(filterByModeExclusivity(candidates, "GENERAL")).toHaveLength(2);
    expect(filterByModeExclusivity(candidates, "COMPETITOR")).toHaveLength(2);
  });
});

describe("dedupeWithinRun", () => {
  it("removes repeats of the same normalized name + city when address1 is unknown", () => {
    const candidates = [candidate(), candidate({ name: "the copper kettle " }), candidate({ name: "Different Bar" })];
    const result = dedupeWithinRun(candidates);
    expect(result).toHaveLength(2);
  });

  it("dedupes the same business found via two different city queries, keyed on address1 rather than city", () => {
    // Google Places splits a metro area into per-neighborhood queries to get
    // past its 60-results-per-query ceiling (see google-places.ts) — each
    // query stamps its own city onto every result, so the same real business
    // can come back twice with two different `city` values.
    const candidates = [
      candidate({ address1: "123 Main St", city: "Toronto", postalCode: "M1A 1A1" }),
      candidate({ address1: "123 Main St", city: "Scarborough", postalCode: "M1A 1A1" }),
    ];
    const result = dedupeWithinRun(candidates);
    expect(result).toHaveLength(1);
  });

  it("keeps two same-named businesses at different addresses in the same city", () => {
    const candidates = [
      candidate({ address1: "123 Main St", city: "Toronto", postalCode: "M1A 1A1" }),
      candidate({ address1: "456 Queen St", city: "Toronto", postalCode: "M1B 2B2" }),
    ];
    const result = dedupeWithinRun(candidates);
    expect(result).toHaveLength(2);
  });
});
