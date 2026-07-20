import { describe, it, expect } from "vitest";
import { matchTerritory, territoryWhereClause, type TerritoryCandidate } from "../../src/lib/workspace/territory-match";

const canada: TerritoryCandidate = { id: "country", name: "Canada-wide", country: "Canada", region: null, city: null };
const ontario: TerritoryCandidate = { id: "region", name: "Ontario", country: "Canada", region: "ON", city: null };
const toronto: TerritoryCandidate = { id: "city", name: "Toronto", country: "Canada", region: "ON", city: "Toronto" };

describe("matchTerritory", () => {
  it("picks the city-level match over region and country when all three overlap", () => {
    const result = matchTerritory({ country: "Canada", region: "ON", city: "Toronto" }, [canada, ontario, toronto]);
    expect(result?.id).toBe("city");
  });

  it("falls back to the region-level match when no city-level territory matches", () => {
    const result = matchTerritory({ country: "Canada", region: "ON", city: "Ottawa" }, [canada, ontario, toronto]);
    expect(result?.id).toBe("region");
  });

  it("falls back to the country-level match when neither region nor city match", () => {
    const result = matchTerritory({ country: "Canada", region: "BC", city: "Vancouver" }, [canada, ontario, toronto]);
    expect(result?.id).toBe("country");
  });

  it("returns null when no territory covers the company's country at all", () => {
    const result = matchTerritory({ country: "United States", region: "NY", city: "New York" }, [canada, ontario, toronto]);
    expect(result).toBeNull();
  });

  it("is case-insensitive", () => {
    const result = matchTerritory({ country: "canada", region: "on", city: "toronto" }, [toronto]);
    expect(result?.id).toBe("city");
  });

  it("ignores territories for a different region even if the city name happens to match", () => {
    const albertaToronto: TerritoryCandidate = { id: "wrong", name: "Not real", country: "Canada", region: "AB", city: "Toronto" };
    const result = matchTerritory({ country: "Canada", region: "ON", city: "Toronto" }, [albertaToronto, ontario]);
    expect(result?.id).toBe("region");
  });
});

describe("territoryWhereClause", () => {
  it("builds a country-only clause when region and city are null", () => {
    expect(territoryWhereClause(canada)).toEqual({ country: { equals: "Canada", mode: "insensitive" } });
  });

  it("builds a country+region clause when city is null", () => {
    expect(territoryWhereClause(ontario)).toEqual({
      country: { equals: "Canada", mode: "insensitive" },
      region: { equals: "ON", mode: "insensitive" },
    });
  });

  it("builds a full country+region+city clause", () => {
    expect(territoryWhereClause(toronto)).toEqual({
      country: { equals: "Canada", mode: "insensitive" },
      region: { equals: "ON", mode: "insensitive" },
      city: { equals: "Toronto", mode: "insensitive" },
    });
  });
});
