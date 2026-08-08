// Discovery provider for PUB_RADIUS mode — Places API (New) "Nearby Search"
// (places:searchNearby), a structurally different call from Text Search
// (google-places.ts): no per-city query string, no pagination, instead a
// lat/lng + radius circle restriction and a Google-defined place-type
// filter. Kept in its own file/class rather than branching inside
// GooglePlacesDiscoveryProvider so GENERAL mode's existing behavior can
// never regress from PUB_RADIUS-only changes.
import { getEnv } from "../../env";
import { callProvider } from "./http";
import { candidateFromPlace, type GooglePlace } from "./google-places";
import type { CandidateDiscoveryProvider, DiscoverParams, DiscoveryProgressUpdate, ResearchCandidate } from "./types";

const NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";

// Same field set as GENERAL mode's Text Search provider (see its FIELD_MASK
// comment for the SKU-tier reasoning) — this call already bills at the same
// "Enterprise" tier once nationalPhoneNumber/websiteUri are requested, so
// addressComponents costs nothing extra on top.
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.businessStatus",
].join(",");

// Google's Nearby Search (New) hard cap — no pagination support at all,
// unlike Text Search's nextPageToken.
const MAX_RESULT_COUNT = 20;

// Google's fixed place-type taxonomy has no literal "pub" type. "bar" is the
// closest built-in category — a deliberate v1 approximation, not an exact
// match. Some real pubs may be miscategorized as "restaurant" and missed;
// some non-pub bars will show up as false positives. Both are acceptable
// here since nothing auto-commits — a rep discards irrelevant "New" rows on
// the review screen. Easy to widen (e.g. add "restaurant") later if this
// undershoots in practice.
const INCLUDED_TYPES = ["bar"];

type PlacesNearbySearchResult = {
  places?: GooglePlace[];
};

export class GooglePlacesNearbyDiscoveryProvider implements CandidateDiscoveryProvider {
  async discover(params: DiscoverParams, onProgress?: (update: DiscoveryProgressUpdate) => Promise<void>): Promise<ResearchCandidate[]> {
    const { GOOGLE_PLACES_API_KEY } = getEnv();
    if (!GOOGLE_PLACES_API_KEY) {
      throw new Error("GOOGLE_PLACES_API_KEY is not set — required to use the Google Places nearby-search provider.");
    }
    if (!params.originLatLng || !params.radiusMeters) {
      // Internal/defensive, not user-facing — run-search.ts always supplies
      // both for PUB_RADIUS mode; a missing value here means a caller bug,
      // not something an end user did wrong.
      throw new Error("GooglePlacesNearbyDiscoveryProvider.discover() requires originLatLng and radiusMeters.");
    }

    const results = await callProvider({ providerName: "google-places-nearby", timeoutMs: 20_000 }, async (signal) => {
      const response = await fetch(NEARBY_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({
          includedTypes: INCLUDED_TYPES,
          maxResultCount: MAX_RESULT_COUNT,
          locationRestriction: {
            circle: {
              center: { latitude: params.originLatLng!.lat, longitude: params.originLatLng!.lng },
              radius: params.radiusMeters,
            },
          },
        }),
        signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Google Places Nearby Search failed (${response.status}): ${errorBody.slice(0, 300)}`);
      }

      const data = (await response.json()) as PlacesNearbySearchResult;
      const candidates: ResearchCandidate[] = [];
      for (const place of data.places ?? []) {
        if (place.businessStatus === "CLOSED_PERMANENTLY" || place.businessStatus === "CLOSED_TEMPORARILY") continue;
        // queryCity ("search area") is only used by candidateFromPlace as a
        // fallback when Google's own locality component is missing — Nearby
        // Search has no query-city concept the way Text Search does.
        candidates.push(candidateFromPlace(place, params, params.cities[0] ?? "search area"));
      }
      return candidates;
    });

    await onProgress?.({ kind: "city", city: params.cities[0] ?? "search area", cityIndex: 0, totalCities: 1, foundSoFar: results.length });

    return results;
  }
}
