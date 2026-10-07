import { describe, it, expect } from "vitest";
import { isInSearchedRegion, placeIsInCity } from "../../src/lib/research/area";

describe("isInSearchedRegion", () => {
  const search = { country: "Canada", region: "ON" };

  it("matches the same province and country however they're written", () => {
    expect(isInSearchedRegion({ country: "Canada", region: "ON" }, search)).toBe(true);
    expect(isInSearchedRegion({ country: "CA", region: "Ontario" }, search)).toBe(true);
  });

  it("rejects another province or another country", () => {
    expect(isInSearchedRegion({ country: "Canada", region: "QC" }, search)).toBe(false);
    expect(isInSearchedRegion({ country: "United States", region: "NY" }, search)).toBe(false);
    expect(isInSearchedRegion({ country: "USA", region: "CO" }, { country: "United States", region: "CO" })).toBe(true);
  });

  it("lets a blank value through, since it can't be checked", () => {
    expect(isInSearchedRegion({ country: "", region: "" }, search)).toBe(true);
  });
});

describe("placeIsInCity", () => {
  it("matches the locality or a smaller name, ignoring case", () => {
    const components = [
      { longText: "Scarborough", types: ["sublocality_level_1"] },
      { longText: "Toronto", types: ["locality"] },
    ];
    expect(placeIsInCity(components, "toronto")).toBe(true);
    expect(placeIsInCity(components, "Scarborough")).toBe(true);
    expect(placeIsInCity(components, "Mississauga")).toBe(false);
  });

  it("lets a place with no city information through", () => {
    expect(placeIsInCity([{ longText: "ON", types: ["administrative_area_level_1"] }], "Milton")).toBe(true);
    expect(placeIsInCity(undefined, "Milton")).toBe(true);
  });
});
