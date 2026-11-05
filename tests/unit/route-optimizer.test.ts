import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GoogleRouteOptimizer, MockRouteOptimizer, RouteOptimizerError, parseOptimizedRoute } from "../../src/lib/research/providers/route-optimizer";
import { formatRouteDistance, formatDriveTime, describeRoutePlan } from "../../src/lib/route-plan/format";
import { sortRouteCompanies } from "../../src/lib/route-plan/validation";
import { resetEnvCacheForTests } from "../../src/lib/env";

const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(() => resetEnvCacheForTests());
afterEach(() => {
  delete mutableEnv.GOOGLE_PLACES_API_KEY;
  resetEnvCacheForTests();
  vi.unstubAllGlobals();
});

describe("parseOptimizedRoute", () => {
  it("reads the visit order, distance and duration", () => {
    const data = { routes: [{ optimizedIntermediateWaypointIndex: [2, 0, 1], distanceMeters: 42_000, duration: "3725.4s" }] };
    expect(parseOptimizedRoute(data, 3)).toEqual({ order: [2, 0, 1], distanceMeters: 42_000, durationSeconds: 3725 });
  });

  it("accepts a single stop with no order returned", () => {
    expect(parseOptimizedRoute({ routes: [{ distanceMeters: 5, duration: "60s" }] }, 1).order).toEqual([0]);
  });

  it("rejects an order that doesn't cover every stop exactly once", () => {
    expect(() => parseOptimizedRoute({ routes: [{ optimizedIntermediateWaypointIndex: [0, 0, 1] }] }, 3)).toThrow(/unusable/);
    expect(() => parseOptimizedRoute({ routes: [{ optimizedIntermediateWaypointIndex: [0, 1] }] }, 3)).toThrow(/unusable/);
  });

  it("explains when Google finds no route", () => {
    expect(() => parseOptimizedRoute({}, 2)).toThrow(RouteOptimizerError);
  });
});

describe("GoogleRouteOptimizer", () => {
  beforeEach(() => {
    mutableEnv.GOOGLE_PLACES_API_KEY = "test-places-key";
    resetEnvCacheForTests();
  });

  it("asks for an optimized round trip from the start address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ optimizedIntermediateWaypointIndex: [1, 0], distanceMeters: 1000, duration: "600s" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GoogleRouteOptimizer().optimize("1 Home St, Milton, ON", ["A St", "B St"]);

    expect(result.order).toEqual([1, 0]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(init.headers["X-Goog-FieldMask"]).toBe("routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration");
    expect(JSON.parse(init.body)).toEqual({
      origin: { address: "1 Home St, Milton, ON" },
      destination: { address: "1 Home St, Milton, ON" },
      intermediates: [{ address: "A St" }, { address: "B St" }],
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      optimizeWaypointOrder: true,
    });
  });

  it("says plainly when the Routes API isn't enabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Routes API has not been used in project 123 before or it is disabled. SERVICE_DISABLED" }));
    await expect(new GoogleRouteOptimizer().optimize("Home", ["A"])).rejects.toThrow(/enable the Routes API/);
  });

  it("says plainly when an address can't be found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad address" }));
    await expect(new GoogleRouteOptimizer().optimize("Nowhere", ["A"])).rejects.toThrow(/couldn't find one of the addresses/);
  });

  it("mock reverses the order without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await new MockRouteOptimizer().optimize("Home", ["A", "B", "C"])).order).toEqual([2, 1, 0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("route plan formatting", () => {
  it("formats distance in km, or miles for a US route", () => {
    expect(formatRouteDistance(142_400, "Canada")).toBe("142 km");
    expect(formatRouteDistance(8_046.72, "USA")).toBe("5.0 mi");
  });

  it("formats drive time", () => {
    expect(formatDriveTime(2_700)).toBe("45 min");
    expect(formatDriveTime(11_400)).toBe("3 h 10 min");
    expect(formatDriveTime(7_200)).toBe("2 h");
  });

  it("describes a planned route, or nothing when unplanned", () => {
    const plan = { startAddress: "1 Home St", optimizedAt: new Date(), distanceMeters: 50_000, durationSeconds: 3_600 };
    expect(describeRoutePlan(plan, "Canada")).toBe("In driving order from 1 Home St and back · 50 km · about 1 h of driving.");
    expect(describeRoutePlan({ ...plan, optimizedAt: null }, "Canada")).toBeNull();
  });
});

describe("sortRouteCompanies with a planned order", () => {
  it("lists planned stops by stop number, then unplanned ones by name", () => {
    const rows = [
      { id: "1", name: "Zed", position: null },
      { id: "2", name: "Bee", position: 2 },
      { id: "3", name: "Ale", position: null },
      { id: "4", name: "Cat", position: 1 },
    ];
    expect(sortRouteCompanies(rows).map((r) => r.name)).toEqual(["Cat", "Bee", "Ale", "Zed"]);
  });
});
