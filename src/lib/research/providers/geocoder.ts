// Address -> coordinates for Pub Lead Finder's radius search. Reuses the
// same Places API (New) Text Search endpoint the discovery provider already
// calls (see TEXT_SEARCH_URL in google-places.ts) rather than enabling
// Google's separate Geocoding API product — querying the pub's own known
// street address as textQuery and taking the first result's location is
// accurate enough for "resolve this specific existing business," and needs
// zero new Google Cloud setup or env vars (GOOGLE_PLACES_API_KEY/
// PLACES_PROVIDER already cover it). Field-masked to just the location, the
// cheapest possible Places (New) request.
import { getEnv } from "../../env";
import { callProvider } from "./http";
import { TEXT_SEARCH_URL } from "./google-places";

export type LatLng = { lat: number; lng: number };

export interface AddressGeocoder {
  geocode(address: string): Promise<LatLng | null>;
}

// Deterministic fixed coordinates (downtown Toronto) — not derived from the
// input address, since mock mode never makes a network call. Good enough for
// exercising the radius-search flow end to end without cost.
const MOCK_COORDINATES: LatLng = { lat: 43.6532, lng: -79.3832 };

export class MockAddressGeocoder implements AddressGeocoder {
  async geocode(_address: string): Promise<LatLng | null> {
    return MOCK_COORDINATES;
  }
}

type PlacesGeocodeSearchResult = {
  places?: { location?: { latitude?: number; longitude?: number } }[];
};

const GEOCODE_FIELD_MASK = "places.location";

export class GooglePlacesAddressGeocoder implements AddressGeocoder {
  async geocode(address: string): Promise<LatLng | null> {
    const { GOOGLE_PLACES_API_KEY } = getEnv();
    if (!GOOGLE_PLACES_API_KEY) {
      throw new Error("GOOGLE_PLACES_API_KEY is not set — required to geocode an address.");
    }

    return callProvider({ providerName: "google-places-geocode", timeoutMs: 10_000 }, async (signal) => {
      const response = await fetch(TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": GEOCODE_FIELD_MASK,
        },
        body: JSON.stringify({ textQuery: address }),
        signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Google Places geocode lookup failed (${response.status}): ${errorBody.slice(0, 300)}`);
      }

      const data = (await response.json()) as PlacesGeocodeSearchResult;
      const location = data.places?.[0]?.location;
      if (!location || typeof location.latitude !== "number" || typeof location.longitude !== "number") {
        return null;
      }
      return { lat: location.latitude, lng: location.longitude };
    });
  }
}

/** Selects the geocoder from PLACES_PROVIDER — the same env var factory.ts already reads for discovery. */
export function getGeocoder(): AddressGeocoder {
  const { PLACES_PROVIDER } = getEnv();
  switch (PLACES_PROVIDER) {
    case "mock":
      return new MockAddressGeocoder();
    case "google":
      return new GooglePlacesAddressGeocoder();
    default:
      throw new Error(`Unknown PLACES_PROVIDER "${PLACES_PROVIDER}" — expected "mock" or "google".`);
  }
}
