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
            formattedAddress: "123 Main St, Milton, ON L9T 1A1",
            addressComponents: [
              { longText: "123", shortText: "123", types: ["street_number"] },
              { longText: "Main St", shortText: "Main St", types: ["route"] },
              { longText: "L9T 1A1", shortText: "L9T 1A1", types: ["postal_code"] },
            ],
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
      address1: "123 Main St",
      city: "Milton",
      region: "ON",
      country: "Canada",
      postalCode: "L9T 1A1",
      phone: "(905) 555-0100",
      websiteUrl: "https://miltonarms.example.test",
      triviaStatus: "UNCERTAIN",
      competitorName: null,
      contactData: null,
      evidence: [],
      sources: [],
    });
  });

  it("leaves postalCode null when the response has no postal_code address component", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [{ displayName: { text: "The Milton Arms" }, addressComponents: [{ longText: "Main St", types: ["route"] }] }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await new GooglePlacesDiscoveryProvider().discover(baseParams);
    expect(candidates[0].postalCode).toBeNull();
  });

  it("appends the subpremise (e.g. suite number) to the street address when present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            displayName: { text: "The Milton Arms" },
            addressComponents: [
              { longText: "123", types: ["street_number"] },
              { longText: "Main St", types: ["route"] },
              { longText: "Suite 200", types: ["subpremise"] },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await new GooglePlacesDiscoveryProvider().discover(baseParams);
    expect(candidates[0].address1).toBe("123 Main St Suite 200");
  });

  it("falls back to formattedAddress when the response has no street_number/route address components", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [{ displayName: { text: "The Milton Arms" }, formattedAddress: "123 Main St, Milton, ON L9T 1A1", addressComponents: [] }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await new GooglePlacesDiscoveryProvider().discover(baseParams);
    expect(candidates[0].address1).toBe("123 Main St, Milton, ON L9T 1A1");
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
    expect(init.headers["X-Goog-FieldMask"]).toContain("places.addressComponents");
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

  it("follows nextPageToken to collect more than 20 results for a dense city", async () => {
    const place = (name: string) => ({ displayName: { text: name }, businessStatus: "OPERATIONAL" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ places: [place("Pub 1")], nextPageToken: "token-page-2" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ places: [place("Pub 2")] }) });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await new GooglePlacesDiscoveryProvider(0).discover(baseParams);

    expect(candidates.map((c) => c.name)).toEqual(["Pub 1", "Pub 2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondRequestBody).toEqual({ textQuery: "Pub in Milton, ON, Canada", pageToken: "token-page-2" });
  });

  it("stops at Google's 3-page ceiling even if nextPageToken keeps coming back", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [{ displayName: { text: "Pub" }, businessStatus: "OPERATIONAL" }], nextPageToken: "keeps-going" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await new GooglePlacesDiscoveryProvider(0).discover(baseParams);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(candidates).toHaveLength(3);
  });

  it("requests nextPageToken in the field mask", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await new GooglePlacesDiscoveryProvider(0).discover(baseParams);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Goog-FieldMask"]).toContain("nextPageToken");
  });
});
