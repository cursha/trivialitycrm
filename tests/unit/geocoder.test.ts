import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GooglePlacesAddressGeocoder, MockAddressGeocoder, getGeocoder } from "../../src/lib/research/providers/geocoder";
import { resetEnvCacheForTests } from "../../src/lib/env";

const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(() => {
  resetEnvCacheForTests();
});

afterEach(() => {
  delete mutableEnv.GOOGLE_PLACES_API_KEY;
  delete mutableEnv.PLACES_PROVIDER;
  resetEnvCacheForTests();
  vi.unstubAllGlobals();
});

describe("MockAddressGeocoder", () => {
  it("returns fixed coordinates without making a network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MockAddressGeocoder().geocode("123 Main St, Milton, ON, Canada");

    expect(result).toEqual({ lat: 43.6532, lng: -79.3832 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GooglePlacesAddressGeocoder", () => {
  beforeEach(() => {
    mutableEnv.GOOGLE_PLACES_API_KEY = "test-places-key";
    resetEnvCacheForTests();
  });

  it("resolves the first Text Search result's location", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [{ location: { latitude: 43.5183, longitude: -79.8774 } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GooglePlacesAddressGeocoder().geocode("123 Main St, Milton, ON, Canada");

    expect(result).toEqual({ lat: 43.5183, lng: -79.8774 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(JSON.parse(init.body).textQuery).toBe("123 Main St, Milton, ON, Canada");
    expect(init.headers["X-Goog-FieldMask"]).toBe("places.location");
  });

  it("returns null when Google returns no places for the address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GooglePlacesAddressGeocoder().geocode("Not a real address");
    expect(result).toBeNull();
  });

  it("throws when GOOGLE_PLACES_API_KEY is not configured", async () => {
    delete mutableEnv.GOOGLE_PLACES_API_KEY;
    resetEnvCacheForTests();

    await expect(new GooglePlacesAddressGeocoder().geocode("123 Main St")).rejects.toThrow(/GOOGLE_PLACES_API_KEY/);
  });

  it("throws a clear error on a non-ok HTTP response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "API key not authorized" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new GooglePlacesAddressGeocoder().geocode("123 Main St")).rejects.toThrow(/403/);
  });
});

describe("getGeocoder", () => {
  it("returns MockAddressGeocoder when PLACES_PROVIDER is unset (default)", () => {
    expect(getGeocoder()).toBeInstanceOf(MockAddressGeocoder);
  });

  it("returns GooglePlacesAddressGeocoder when PLACES_PROVIDER=google", () => {
    mutableEnv.PLACES_PROVIDER = "google";
    mutableEnv.GOOGLE_PLACES_API_KEY = "test-places-key";
    resetEnvCacheForTests();

    expect(getGeocoder()).toBeInstanceOf(GooglePlacesAddressGeocoder);
  });
});
