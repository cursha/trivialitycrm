// Company page "Find address": looks up a bar's street address on Google
// Places by its name and city. Same Places API (New) Text Search endpoint
// and key as discovery and the geocoder (see TEXT_SEARCH_URL in
// google-places.ts), so it needs no new Google Cloud setup. Field-masked to
// name + address only (the cheaper "Pro" tier, no phone/website), and not an
// AI call. Mock mode never makes a network call.
import { getEnv } from "../../env";
import { callProvider } from "./http";
import { TEXT_SEARCH_URL, componentText, extractPostalCode, extractStreetAddress, type PlaceAddressComponent } from "./google-places";
import { isInSearchedRegion, placeIsInCity } from "../area";
import { normalizeCompanyName } from "../../duplicates/normalize";

export type AddressLookupQuery = { name: string; city: string; region: string; country: string };
export type FoundAddress = { address1: string; postalCode: string | null; formattedAddress: string };

export interface AddressLookup {
  findAddress(query: AddressLookupQuery): Promise<FoundAddress | null>;
}

export class MockAddressLookup implements AddressLookup {
  async findAddress(query: AddressLookupQuery): Promise<FoundAddress | null> {
    return { address1: "100 Mock Street", postalCode: null, formattedAddress: `100 Mock Street, ${query.city}, ${query.region}` };
  }
}

type LookupPlace = { displayName?: { text?: string }; formattedAddress?: string; addressComponents?: PlaceAddressComponent[] };

const LOOKUP_FIELD_MASK = ["places.displayName", "places.formattedAddress", "places.addressComponents"].join(",");

/** Google's name and ours are the same bar when one contains the other once
 * normalized ("O'Malley's" / "O'Malley's Irish Pub"). Text Search will
 * happily return a different nearby bar, which would be worse than nothing. */
function sameBusiness(placeName: string | undefined, companyName: string): boolean {
  if (!placeName) return false;
  const a = normalizeCompanyName(placeName);
  const b = normalizeCompanyName(companyName);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** The first result that is this bar, in this city and province/state, with
 * a real street address. Exported for tests. */
export function pickAddress(places: LookupPlace[] | undefined, query: AddressLookupQuery): FoundAddress | null {
  for (const place of places ?? []) {
    if (!sameBusiness(place.displayName?.text, query.name)) continue;
    const components = place.addressComponents;
    const region = componentText(components?.find((c) => c.types?.includes("administrative_area_level_1"))) ?? "";
    const country = componentText(components?.find((c) => c.types?.includes("country"))) ?? "";
    if (!isInSearchedRegion({ country, region }, { country: query.country, region: query.region })) continue;
    if (!placeIsInCity(components, query.city)) continue;
    // No street number/route means Google only knows it by name — not an address.
    const address1 = extractStreetAddress(components, null);
    if (!address1) continue;
    return { address1, postalCode: extractPostalCode(components), formattedAddress: place.formattedAddress ?? address1 };
  }
  return null;
}

export class GooglePlacesAddressLookup implements AddressLookup {
  async findAddress(query: AddressLookupQuery): Promise<FoundAddress | null> {
    const { GOOGLE_PLACES_API_KEY } = getEnv();
    if (!GOOGLE_PLACES_API_KEY) {
      throw new Error("GOOGLE_PLACES_API_KEY is not set — required to look up an address.");
    }
    const textQuery = [query.name, query.city, query.region, query.country].filter((part) => part.trim()).join(", ");

    return callProvider({ providerName: "google-places-address", timeoutMs: 10_000 }, async (signal) => {
      const response = await fetch(TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": LOOKUP_FIELD_MASK,
        },
        body: JSON.stringify({ textQuery, pageSize: 5 }),
        signal,
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Google Places address lookup failed (${response.status}): ${errorBody.slice(0, 300)}`);
      }
      const data = (await response.json()) as { places?: LookupPlace[] };
      return pickAddress(data.places, query);
    });
  }
}

/** Selects the lookup from PLACES_PROVIDER, like getGeocoder(). */
export function getAddressLookup(): AddressLookup {
  const { PLACES_PROVIDER } = getEnv();
  switch (PLACES_PROVIDER) {
    case "mock":
      return new MockAddressLookup();
    case "google":
      return new GooglePlacesAddressLookup();
    default:
      throw new Error(`Unknown PLACES_PROVIDER "${PLACES_PROVIDER}" — expected "mock" or "google".`);
  }
}
