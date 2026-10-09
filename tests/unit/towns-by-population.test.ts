import { describe, it, expect } from "vitest";
import { findTownsByPopulation } from "../../src/lib/research/towns-by-population";
import { usPlaceName } from "../../scripts/build-population-data";
import { TownPopulationSchema } from "../../src/lib/validation/search";

describe("findTownsByPopulation", () => {
  it("finds Ontario towns in a range, largest first", () => {
    const { towns, totalMatches, source } = findTownsByPopulation("Canada", "ON", 100_000, 150_000, 50);
    expect(towns.map((town) => town.name)).toContain("Milton");
    expect(towns.every((town) => town.population >= 100_000 && town.population <= 150_000)).toBe(true);
    expect(towns.map((town) => town.population)).toEqual([...towns.map((town) => town.population)].sort((a, b) => b - a));
    expect(totalMatches).toBe(towns.length);
    expect(source).toMatch(/Statistics Canada/);
  });

  it("finds US cities, under their everyday names", () => {
    const { towns } = findTownsByPopulation("United States", "co", 400_000, null, 50);
    expect(towns.map((town) => town.name)).toEqual(expect.arrayContaining(["Denver", "Colorado Springs", "Aurora"]));
  });

  it("caps the list and reports how many matched", () => {
    const { towns, totalMatches } = findTownsByPopulation("United States", "TX", 1_000, null, 50);
    expect(towns).toHaveLength(50);
    expect(totalMatches).toBeGreaterThan(50);
  });

  it("leaves out reserves and unorganized areas", () => {
    const names = findTownsByPopulation("Canada", "BC", null, null, 10_000).towns.map((town) => town.name);
    expect(names).not.toContain("Hamilton Creek 2");
    expect(names.some((name) => /Unorganized/i.test(name))).toBe(false);
  });

  it("returns nothing for an unknown province or state", () => {
    expect(findTownsByPopulation("Canada", "ZZ", 1, null, 50)).toMatchObject({ towns: [], totalMatches: 0 });
  });
});

describe("usPlaceName", () => {
  it("drops the census type and uses the name Google files a place under", () => {
    expect(usPlaceName("Boise City city")).toBe("Boise City");
    expect(usPlaceName("Lake in the Hills village")).toBe("Lake in the Hills");
    expect(usPlaceName("San Buenaventura (Ventura) city")).toBe("Ventura");
    expect(usPlaceName("Athens-Clarke County unified government (balance)")).toBe("Athens");
    expect(usPlaceName("Louisville/Jefferson County metro government (balance)")).toBe("Louisville");
    expect(usPlaceName("Winston-Salem city")).toBe("Winston-Salem");
    expect(usPlaceName("Cherry Hill township")).toBe("Cherry Hill");
  });
});

describe("TownPopulationSchema", () => {
  const base = { country: "Canada", region: "on", min: "", max: "" };

  it("reads numbers with commas and allows one side blank", () => {
    expect(TownPopulationSchema.parse({ ...base, min: "10,000" })).toEqual({ country: "Canada", region: "ON", min: 10_000, max: null });
  });

  it("needs at least one bound, numbers only, smallest not above largest", () => {
    expect(TownPopulationSchema.safeParse(base).success).toBe(false);
    expect(TownPopulationSchema.safeParse({ ...base, min: "lots" }).error?.issues[0].message).toMatch(/as a number/);
    expect(TownPopulationSchema.safeParse({ ...base, min: "50000", max: "10000" }).error?.issues[0].message).toMatch(/bigger than the largest/);
  });
});
