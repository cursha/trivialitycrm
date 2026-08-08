import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GooglePlacesNearbyDiscoveryProvider } from "../../src/lib/research/providers/google-places-nearby";
import { resetEnvCacheForTests } from "../../src/lib/env";
import type { DiscoverParams } from "../../src/lib/research/providers/types";

const baseParams: DiscoverParams = {
  promptText: "unused for directory discovery",
  country: "Canada",
  region: "ON",
  cities: ["Milton"],
  leadTypeName: "Pub",
  mode: "PUB_RADIUS",
  originLatLng: { lat: 43.5183, lng: -79.8774 },
  radiusMeters: 8046.7, // 5 miles
};

const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(() => {
  mutableEnv.GOOGLE_PLACES_API_KEY = "test-places-key";
  resetEnvCacheForTests();
});

afterEach(() => {
  delete mutableEnv.GOOGLE_PLACES_API_KEY;
  resetEnvCacheForTests();
  vi.unstubAllGlobals();
});

describe("GooglePlacesNearbyDiscoveryProvider", () => {
  it("maps a Nearby Search response into ResearchCandidate shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            displayName: { text: "The Milton Arms" },
            formattedAddress: "123 Main St, Milton, ON L9T 1A1",
            addressComponents: [
              { longText: "123", types: ["street_number"] },
              { longText: "Main St", types: ["route"] },
              { longText: "L9T 1A1", types: ["postal_code"] },
              { longText: "Milton", types: ["locality"] },
            ],
            nationalPhoneNumber: "(905) 555-0100",
            websiteUri: "https://miltonarms.example.test",
            businessStatus: "OPERATIONAL",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await new GooglePlacesNearbyDiscoveryProvider().discover(baseParams);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: "The Milton Arms",
      address1: "123 Main St",
      city: "Milton",
      region: "ON",
      country: "Canada",
      postalCode: "L9T 1A1",
      phone: "(905) 555-0100",
      websiteUrl: "https://miltonarms.example.test",
      triviaStatus: "UNCERTAIN",
    });
  });

  it("sends locationRestriction.circle built from originLatLng/radiusMeters, and includedTypes: [\"bar\"]", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await new GooglePlacesNearbyDiscoveryProvider().discover(baseParams);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    const body = JSON.parse(init.body);
    expect(body.includedTypes).toEqual(["bar"]);
    expect(body.locationRestriction.circle).toEqual({
      center: { latitude: 43.5183, longitude: -79.8774 },
      radius: 8046.7,
    });
  });

  it("drops permanently and temporarily closed businesses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          { displayName: { text: "Open Pub" }, businessStatus: "OPERATIONAL" },
          { displayName: { text: "Closed Pub" }, businessStatus: "CLOSED_PERMANENTLY" },
          { displayName: { text: "Temp Closed Pub" }, businessStatus: "CLOSED_TEMPORARILY" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await new GooglePlacesNearbyDiscoveryProvider().discover(baseParams);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("Open Pub");
  });

  it("throws when GOOGLE_PLACES_API_KEY is not configured", async () => {
    delete mutableEnv.GOOGLE_PLACES_API_KEY;
    resetEnvCacheForTests();

    await expect(new GooglePlacesNearbyDiscoveryProvider().discover(baseParams)).rejects.toThrow(/GOOGLE_PLACES_API_KEY/);
  });

  it("throws a clear internal error when originLatLng/radiusMeters are missing (defensive — run-search.ts always supplies both for PUB_RADIUS)", async () => {
    const { originLatLng, radiusMeters, ...withoutGeo } = baseParams;
    void originLatLng;
    void radiusMeters;

    await expect(new GooglePlacesNearbyDiscoveryProvider().discover(withoutGeo)).rejects.toThrow(/originLatLng and radiusMeters/);
  });

  it("throws a clear error on a non-ok HTTP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "API key not authorized" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new GooglePlacesNearbyDiscoveryProvider().discover(baseParams)).rejects.toThrow(/403/);
  });
});
