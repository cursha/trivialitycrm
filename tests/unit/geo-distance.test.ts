import { describe, it, expect } from "vitest";
import { radiusToMeters, RADIUS_BOUNDS } from "../../src/lib/geo/distance";

describe("radiusToMeters", () => {
  it("converts miles to meters", () => {
    expect(radiusToMeters(1, "MI")).toBeCloseTo(1609.34, 2);
    expect(radiusToMeters(10, "MI")).toBeCloseTo(16093.4, 1);
  });

  it("converts kilometers to meters", () => {
    expect(radiusToMeters(1, "KM")).toBe(1000);
    expect(radiusToMeters(80, "KM")).toBe(80_000);
  });
});

describe("RADIUS_BOUNDS", () => {
  it("matches the acceptance criteria's bounds (1-50 mi, 1-80 km)", () => {
    expect(RADIUS_BOUNDS.MI).toEqual({ min: 1, max: 50 });
    expect(RADIUS_BOUNDS.KM).toEqual({ min: 1, max: 80 });
  });
});
