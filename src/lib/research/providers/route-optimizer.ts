// Route Plan "Put stops in driving order": Google Routes API computeRoutes
// with optimizeWaypointOrder, starting and finishing at the rep's start
// address. Stops are sent as plain addresses (Waypoint.address), so nothing
// needs geocoding first. Billed as "Routes: Compute Routes Pro" (5,000 free
// a month, then about 1¢ each); the Routes API must be enabled on the same
// Google key as Places (GOOGLE_PLACES_API_KEY). Mock mode never calls out.
import { getEnv } from "../../env";
import { callProvider } from "./http";

const COMPUTE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const FIELD_MASK = "routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration";

/** Google's own limit for intermediate waypoints in one request. */
export const MAX_OPTIMIZED_STOPS = 25;

export type OptimizedRoute = {
  /** Indexes into the stops passed in, in driving order. */
  order: number[];
  distanceMeters: number;
  durationSeconds: number;
};

/** A problem worth showing the rep in plain words (vs. an unexpected failure). */
export class RouteOptimizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteOptimizerError";
  }
}

export interface RouteOptimizer {
  optimize(startAddress: string, stopAddresses: string[]): Promise<OptimizedRoute>;
}

export class MockRouteOptimizer implements RouteOptimizer {
  async optimize(_startAddress: string, stopAddresses: string[]): Promise<OptimizedRoute> {
    // Reversed, so a test can tell the order was applied.
    return { order: stopAddresses.map((_, index) => index).reverse(), distanceMeters: 12_345, durationSeconds: 3_600 };
  }
}

/** "3600s" → 3600. */
function parseDurationSeconds(value: string | undefined): number {
  const seconds = value ? Number.parseFloat(value.replace(/s$/, "")) : Number.NaN;
  return Number.isFinite(seconds) ? Math.round(seconds) : 0;
}

/** The response's order, checked to be a full permutation of the stops. Exported for tests. */
export function parseOptimizedRoute(data: unknown, stopCount: number): OptimizedRoute {
  const route = (data as { routes?: { optimizedIntermediateWaypointIndex?: number[]; distanceMeters?: number; duration?: string }[] })?.routes?.[0];
  if (!route) throw new RouteOptimizerError("Google couldn't find a driving route between these stops. Check the start address and the bars' addresses.");
  // A single stop needs no ordering, and Google may return the field empty.
  const order = stopCount === 1 ? [0] : (route.optimizedIntermediateWaypointIndex ?? []);
  const isPermutation = order.length === stopCount && new Set(order).size === stopCount && order.every((i) => Number.isInteger(i) && i >= 0 && i < stopCount);
  if (!isPermutation) throw new Error(`Routes API returned an unusable stop order for ${stopCount} stops.`);
  return { order, distanceMeters: route.distanceMeters ?? 0, durationSeconds: parseDurationSeconds(route.duration) };
}

export class GoogleRouteOptimizer implements RouteOptimizer {
  async optimize(startAddress: string, stopAddresses: string[]): Promise<OptimizedRoute> {
    const { GOOGLE_PLACES_API_KEY } = getEnv();
    if (!GOOGLE_PLACES_API_KEY) throw new Error("GOOGLE_PLACES_API_KEY is not set — required to plan a route.");

    return callProvider({ providerName: "google-routes", timeoutMs: 20_000 }, async (signal) => {
      const response = await fetch(COMPUTE_ROUTES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": FIELD_MASK },
        body: JSON.stringify({
          origin: { address: startAddress },
          destination: { address: startAddress },
          intermediates: stopAddresses.map((address) => ({ address })),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
          optimizeWaypointOrder: true,
        }),
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 403 && /routes\.googleapis\.com|Routes API|SERVICE_DISABLED|has not been used/i.test(body)) {
          throw new RouteOptimizerError("Route planning isn't switched on yet: an administrator needs to enable the Routes API for the CRM's Google key.");
        }
        if (response.status === 400 || response.status === 404) {
          throw new RouteOptimizerError("Google couldn't find one of the addresses. Check the start address and the bars' addresses.");
        }
        throw new Error(`Routes API computeRoutes failed (${response.status}): ${body.slice(0, 300)}`);
      }
      return parseOptimizedRoute(await response.json(), stopAddresses.length);
    });
  }
}

/** Selects the optimizer from PLACES_PROVIDER, like the other Google lookups. */
export function getRouteOptimizer(): RouteOptimizer {
  const { PLACES_PROVIDER } = getEnv();
  switch (PLACES_PROVIDER) {
    case "mock":
      return new MockRouteOptimizer();
    case "google":
      return new GoogleRouteOptimizer();
    default:
      throw new Error(`Unknown PLACES_PROVIDER "${PLACES_PROVIDER}" — expected "mock" or "google".`);
  }
}
