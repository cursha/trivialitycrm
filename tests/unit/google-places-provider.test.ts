import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GooglePlacesDiscoveryProvider } from "../../src/lib/research/providers/google-places";
import { resetEnvCacheForTests } from "../../src/lib/env";
import type { DiscoverParams } from "../../src/lib/research/providers/types";

const baseParams: DiscoverParams = {
  promptText: "unused for directory discovery",
  country: "Canada",
  region: "ON",
  cities: ["Milton"],
  leadTypeName: "Pub",
  mode: "GENERAL",
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

describe("GooglePlacesDiscoveryProvider", () => {
  it("maps a Text Search response into ResearchCandidate shape, defaulting AI-only fields honestly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            displayName: { text: "The Milton Arms" },
            formattedAddress: "123 Main St, Milton, ON",
            nationalPhoneNumber: "(905) 555-0100",
            websiteUri: "https://miltonarms.example.test",
            businessStatus: "OPERATIONAL",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GooglePlacesDiscoveryProvider();
    const candidates = await provider.discover(baseParams);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: "The Milton Arms",
      address1: "123 Main St, Milton, ON",
      city: "Milton",
      region: "ON",
      country: "Canada",
      phone: "(905) 555-0100",
      websiteUrl: "https://miltonarms.example.test",
      triviaStatus: "UNCERTAIN",
      competitorName: null,
      contactData: null,
      evidence: [],
      sources: [],
    });
  });

  it("sends the field mask and API key as headers, and the city+leadType+region+country as the text query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await new GooglePlacesDiscoveryProvider().discover(baseParams);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-places-key");
    expect(init.headers["X-Goog-FieldMask"]).toContain("places.nationalPhoneNumber");
    expect(JSON.parse(init.body).textQuery).toBe("Pub in Milton, ON, Canada");
  });

  it("makes one request per city", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await new GooglePlacesDiscoveryProvider().discover({ ...baseParams, cities: ["Milton", "Oakville", "Burlington"] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
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

    const candidates = await new GooglePlacesDiscoveryProvider().discover(baseParams);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("Open Pub");
  });

  it("throws a clear error on a non-ok HTTP response rather than silently returning nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "API key not authorized" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new GooglePlacesDiscoveryProvider().discover(baseParams)).rejects.toThrow(/403/);
  });

  it("throws when GOOGLE_PLACES_API_KEY is not configured", async () => {
    delete mutableEnv.GOOGLE_PLACES_API_KEY;
    resetEnvCacheForTests();

    await expect(new GooglePlacesDiscoveryProvider().discover(baseParams)).rejects.toThrow(/GOOGLE_PLACES_API_KEY/);
  });

  it("falls back to the region when no cities are given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await new GooglePlacesDiscoveryProvider().discover({ ...baseParams, cities: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).textQuery).toBe("Pub in ON, ON, Canada");
  });
});
