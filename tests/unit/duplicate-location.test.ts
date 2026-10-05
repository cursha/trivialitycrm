import { describe, it, expect } from "vitest";
import { locationCorroborates, sameCityAndRegion, streetAddressesConflict } from "../../src/lib/duplicates/location";

describe("duplicate location corroboration", () => {
  it("needs both city and province/state to match, ignoring case and spacing", () => {
    expect(sameCityAndRegion({ city: "Milton", region: "ON" }, { city: " milton ", region: "on" })).toBe(true);
    expect(sameCityAndRegion({ city: "Milton", region: "ON" }, { city: "Oakville", region: "ON" })).toBe(false);
    expect(sameCityAndRegion({ city: "Springfield", region: "IL" }, { city: "Springfield", region: "MO" })).toBe(false);
    expect(sameCityAndRegion({ city: "Milton", region: null }, { city: "Milton", region: null })).toBe(false);
  });

  it("treats two different street addresses as a conflict, but a missing one as no conflict", () => {
    expect(streetAddressesConflict({ address1: "100 Main St" }, { address1: "100 Main Street" })).toBe(false);
    expect(streetAddressesConflict({ address1: "100 Main St" }, { address1: "900 Queen St" })).toBe(true);
    expect(streetAddressesConflict({ address1: "100 Main St" }, { address1: null })).toBe(false);
  });

  it("corroborates only when the city and province agree and the street addresses don't conflict", () => {
    const here = { city: "Milton", region: "ON", address1: "100 Main St" };
    expect(locationCorroborates(here, { city: "Milton", region: "ON", address1: null })).toBe(true);
    expect(locationCorroborates(here, { city: "Milton", region: "ON", address1: "900 Queen St" })).toBe(false);
    expect(locationCorroborates(here, { city: "Oakville", region: "ON", address1: "100 Main St" })).toBe(false);
  });
});
