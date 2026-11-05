import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GooglePlacesAddressLookup, MockAddressLookup, pickAddress } from "../../src/lib/research/providers/address-lookup";
import { resetEnvCacheForTests } from "../../src/lib/env";

const mutableEnv = process.env as Record<string, string | undefined>;
const query = { name: "O'Malley's", city: "Milton", region: "ON", country: "Canada" };

function place(name: string, opts: { city?: string; region?: string; number?: string; route?: string; postal?: string } = {}) {
  const { city = "Milton", region = "ON", number = "45", route = "Main St E", postal = "L9T 1N4" } = opts;
  return {
    displayName: { text: name },
    formattedAddress: `${number} ${route}, ${city}, ${region} ${postal}, Canada`,
    addressComponents: [
      ...(number ? [{ longText: number, types: ["street_number"] }] : []),
      ...(route ? [{ longText: route, types: ["route"] }] : []),
      { longText: city, types: ["locality"] },
      { longText: region === "BC" ? "British Columbia" : "Ontario", shortText: region, types: ["administrative_area_level_1"] },
      { longText: "Canada", shortText: "CA", types: ["country"] },
      { longText: postal, types: ["postal_code"] },
    ],
  };
}

beforeEach(() => resetEnvCacheForTests());
afterEach(() => {
  delete mutableEnv.GOOGLE_PLACES_API_KEY;
  resetEnvCacheForTests();
  vi.unstubAllGlobals();
});

describe("pickAddress", () => {
  it("takes the street address and postal code of the matching bar", () => {
    expect(pickAddress([place("O'Malley's Irish Pub")], query)).toEqual({
      address1: "45 Main St E",
      postalCode: "L9T 1N4",
      formattedAddress: "45 Main St E, Milton, ON L9T 1N4, Canada",
    });
  });

  it("skips a different bar Google returns first", () => {
    const result = pickAddress([place("The Ale House", { number: "1" }), place("O'Malley's")], query);
    expect(result?.address1).toBe("45 Main St E");
  });

  it("skips a same-named bar in another city or province", () => {
    expect(pickAddress([place("O'Malley's", { city: "Oakville" })], query)).toBeNull();
    expect(pickAddress([place("O'Malley's", { region: "BC" })], query)).toBeNull();
  });

  it("returns null when Google has no street address for it", () => {
    expect(pickAddress([place("O'Malley's", { number: "", route: "" })], query)).toBeNull();
    expect(pickAddress(undefined, query)).toBeNull();
  });
});

describe("address lookup providers", () => {
  it("mock never calls the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await new MockAddressLookup().findAddress(query))?.address1).toBe("100 Mock Street");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Google searches by name and city with a name/address-only field mask", async () => {
    mutableEnv.GOOGLE_PLACES_API_KEY = "test-places-key";
    resetEnvCacheForTests();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [place("O'Malley's")] }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GooglePlacesAddressLookup().findAddress(query);

    expect(result?.address1).toBe("45 Main St E");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).textQuery).toBe("O'Malley's, Milton, ON, Canada");
    expect(init.headers["X-Goog-FieldMask"]).toBe("places.displayName,places.formattedAddress,places.addressComponents");
  });

  it("Google throws without an API key", async () => {
    await expect(new GooglePlacesAddressLookup().findAddress(query)).rejects.toThrow(/GOOGLE_PLACES_API_KEY/);
  });
});
