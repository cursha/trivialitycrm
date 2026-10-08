// Fast, cheap business-directory discovery for GENERAL-mode lead searches —
// see src/lib/research/providers/factory.ts for why this only ever backs
// GENERAL mode. Not an AI call: no web_search/web_fetch tool use, no
// checkAiBudget() gate, no AiUsageRecord tracking (that model is scoped to
// Anthropic operations). Up to three Places "Text Search (New)" requests per
// city (Google's own documented 60-result ceiling across pages, 20 per
// page), field-masked to the cheapest SKU tier that still includes
// phone/website. Real pricing research found Text Search + phone/website
// lands in Google's "Enterprise" SKU, ~$0.035/call, with a real monthly free
// allowance that very likely covers this app's actual usage entirely.
import { getEnv } from "../../env";
import type { CandidateDiscoveryProvider, DiscoverParams, DiscoveryProgressUpdate, ResearchCandidate } from "./types";
import type { SearchEntertainment, SearchVenueKind } from "../../../generated/prisma/enums";
import { isInSearchedRegion, placeIsInCity } from "../area";

// Exported: geocoder.ts reuses this same Text Search endpoint to resolve a
// known address to coordinates (see that file for why a separate Geocoding
// API product isn't used).
export const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Only the fields this app actually stores — requesting anything from the
// Atmosphere tier (rating, reviews, price level) would push every call into
// a more expensive SKU for data nothing here displays. nextPageToken must be
// explicitly requested too, same as any other field, or Google omits it.
// addressComponents is itself a cheaper "Pro" tier field, but the call
// already requests nationalPhoneNumber/websiteUri (both "Enterprise" tier)
// — Google bills the whole call at the highest tier requested regardless,
// so adding it costs nothing on top of what this call already pays for.
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.businessStatus",
  "nextPageToken",
].join(",");

// Google's own documented ceiling: max 20 results per page, max 60 total
// across pages for Text Search (New).
const MAX_PAGES_PER_CITY = 3;

// Exported: shared with google-places-nearby.ts and geocoder.ts, which parse
// the same addressComponents shape from Places API (New)'s other endpoints
// (Nearby Search, Text Search-as-geocode) — see those files for why this
// isn't duplicated.
export type PlaceAddressComponent = { longText?: string; shortText?: string; types?: string[] };

type PlacesTextSearchResult = {
  places?: {
    displayName?: { text?: string };
    formattedAddress?: string;
    addressComponents?: PlaceAddressComponent[];
    nationalPhoneNumber?: string;
    websiteUri?: string;
    businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  }[];
  nextPageToken?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractPostalCode(addressComponents: PlaceAddressComponent[] | undefined): string | null {
  const component = addressComponents?.find((c) => c.types?.includes("postal_code"));
  return component?.longText ?? component?.shortText ?? null;
}

// queryCity is what this app searched FOR (a real city entry, or — for a
// "no city filter, search the whole region" run — the region code itself
// used as the query's geographic scope, e.g. "Pub in ON, ON, Canada"). It is
// NOT necessarily where a given result actually is. Google's own locality
// component is the place's real city; only fall back to queryCity (which,
// for a whole-region run, is really the region code, not a city — a known,
// accepted imprecision) when Google didn't return one.
export function extractCity(addressComponents: PlaceAddressComponent[] | undefined, queryCity: string): string {
  const component = addressComponents?.find((c) => c.types?.includes("locality"));
  return component?.longText ?? component?.shortText ?? queryCity;
}

export function componentText(component: PlaceAddressComponent | undefined): string | undefined {
  return component?.longText ?? component?.shortText ?? undefined;
}

// formattedAddress is the whole "123 Main St, Springfield, IL 62704, USA"
// string — city/region/postalCode/country are already their own
// ResearchCandidate fields, so address1 must hold only the street portion.
// Built from addressComponents (already requested for extractPostalCode)
// rather than string-splitting formattedAddress, which is locale-dependent.
// Falls back to formattedAddress on the rare place with no street_number/
// route components (e.g. a location known only by name) rather than null.
export function extractStreetAddress(addressComponents: PlaceAddressComponent[] | undefined, fallback: string | null): string | null {
  const streetNumber = componentText(addressComponents?.find((c) => c.types?.includes("street_number")));
  const route = componentText(addressComponents?.find((c) => c.types?.includes("route")));
  const street = [streetNumber, route].filter(Boolean).join(" ");
  if (!street) return fallback;
  const subpremise = componentText(addressComponents?.find((c) => c.types?.includes("subpremise")));
  return subpremise ? `${street} ${subpremise}` : street;
}

// Exported: the Place resource shape (displayName/formattedAddress/
// addressComponents/nationalPhoneNumber/websiteUri/businessStatus) is
// identical whether it comes back from Text Search or Nearby Search (New) —
// both are the same underlying Places API (New) resource — so
// google-places-nearby.ts reuses this mapper unchanged rather than
// duplicating it.
export type GooglePlace = NonNullable<PlacesTextSearchResult["places"]>[number];

const ENTERTAINMENT_PHRASES: Record<SearchEntertainment, string> = {
  TRIVIA: "with trivia night",
  KARAOKE: "with karaoke",
  BINGO: "with bingo night",
  // Catches venues that list an events calendar (open mic, game nights and
  // so on). Live music is deliberately not its own option: Curt's call, it
  // draws a different audience from trivia.
  EVENTS: "with weekly events",
};

const VENUE_KIND_TERMS: Record<SearchVenueKind, string> = { PUB: "Pub", BAR: "Bar", TAVERN: "Tavern" };

// The Google place type each venue kind is held to (Places API Table A —
// it has "pub" and "bar" but no tavern type, so a tavern search is held to
// "bar"). Without it Google matches the words alone: "Bar with weekly
// events in Milton" returned fairgrounds, parks and community centres.
const VENUE_KIND_PLACE_TYPES: Record<SearchVenueKind, string> = { PUB: "pub", BAR: "bar", TAVERN: "bar" };

export type PlacesQuery = { textQuery: string; includedType?: string };

/**
 * The Text Search queries for one city: "Pub in Oakville, ON, Canada" —
 * one per venue kind ticked on Quick Search (Pub, Bar, Tavern; the Lead
 * Type's name when none), times one per entertainment ticked ("Pub with
 * trivia night in …", "Bar with karaoke in …"). "And/or" by running each
 * and letting run-search's dedupeWithinRun merge the overlap. Google
 * matches these from listings and reviews, so it's a best guess, not
 * confirmation.
 */
export function placesTextQueries(params: Pick<DiscoverParams, "leadTypeName" | "region" | "country" | "entertainment" | "venueKinds">, city: string): PlacesQuery[] {
  const place = `in ${city}, ${params.region}, ${params.country}`;
  // A search by the Lead Type's own name has no place type to hold it to.
  const terms: { term: string; includedType?: string }[] = params.venueKinds?.length
    ? params.venueKinds.map((kind) => ({ term: VENUE_KIND_TERMS[kind], includedType: VENUE_KIND_PLACE_TYPES[kind] }))
    : [{ term: params.leadTypeName }];
  const entertainment = params.entertainment ?? [];
  return terms.flatMap(({ term, includedType }) =>
    (entertainment.length === 0 ? [`${term} ${place}`] : entertainment.map((kind) => `${term} ${ENTERTAINMENT_PHRASES[kind]} ${place}`)).map((textQuery) =>
      includedType ? { textQuery, includedType } : { textQuery },
    ),
  );
}

// The place's own province/state code and country, not the searched-for
// ones — stamping the search's region on every result hid out-of-area
// places as in-area ones. Falls back to the search's only when Google
// returns no such component.
function componentOfType(addressComponents: PlaceAddressComponent[] | undefined, type: string): PlaceAddressComponent | undefined {
  return addressComponents?.find((c) => c.types?.includes(type));
}

export function candidateFromPlace(place: GooglePlace, params: DiscoverParams, queryCity: string): ResearchCandidate {
  const region = componentOfType(place.addressComponents, "administrative_area_level_1");
  const country = componentOfType(place.addressComponents, "country");
  return {
    name: place.displayName?.text ?? "Unknown business",
    address1: extractStreetAddress(place.addressComponents, place.formattedAddress ?? null),
    city: extractCity(place.addressComponents, queryCity),
    region: region?.shortText ?? region?.longText ?? params.region,
    postalCode: extractPostalCode(place.addressComponents),
    country: country?.longText ?? country?.shortText ?? params.country,
    phone: place.nationalPhoneNumber ?? null,
    email: null,
    websiteUrl: place.websiteUri ?? null,
    contactData: null,
    // A business directory has no way to know this — left honestly
    // UNCERTAIN rather than guessed. See results-table.tsx's "Research this
    // business" action for how a user opts into finding out.
    triviaStatus: "UNCERTAIN",
    competitorName: null,
    day: null,
    evidence: [],
    sources: [],
  };
}

export class GooglePlacesDiscoveryProvider implements CandidateDiscoveryProvider {
  /**
   * `pageDelayMs`: Google requires a short wait after receiving a
   * `nextPageToken` before it becomes usable; an immediate follow-up request
   * reliably 400s. Configurable only so tests can zero it out — production
   * always uses the default.
   */
  constructor(private readonly pageDelayMs = 2000) {}

  async discover(params: DiscoverParams, onProgress?: (update: DiscoveryProgressUpdate) => Promise<void>): Promise<ResearchCandidate[]> {
    const { GOOGLE_PLACES_API_KEY } = getEnv();
    if (!GOOGLE_PLACES_API_KEY) {
      throw new Error("GOOGLE_PLACES_API_KEY is not set — required to use the Google Places discovery provider.");
    }

    const cities = params.cities.length > 0 ? params.cities : [params.region];
    const results: ResearchCandidate[] = [];

    for (const [cityIndex, city] of cities.entries()) {
      for (const query of placesTextQueries(params, city)) {
        let pageToken: string | undefined;

        for (let page = 0; page < MAX_PAGES_PER_CITY; page++) {
          // Per Google's docs, every field besides maxResultCount/pageSize/
          // pageToken must stay identical across pages of the same search.
          // strictTypeFiltering: only places of includedType come back, not
          // just places ranked as more likely to be one.
          const body: { textQuery: string; includedType?: string; strictTypeFiltering?: boolean; pageToken?: string } = query.includedType
            ? { textQuery: query.textQuery, includedType: query.includedType, strictTypeFiltering: true }
            : { textQuery: query.textQuery };
          if (pageToken) body.pageToken = pageToken;

          const response = await fetch(TEXT_SEARCH_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
              "X-Goog-FieldMask": FIELD_MASK,
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(`Google Places Text Search failed (${response.status}) for "${city}": ${errorBody.slice(0, 300)}`);
          }

          const data = (await response.json()) as PlacesTextSearchResult;
          for (const place of data.places ?? []) {
            if (place.businessStatus === "CLOSED_PERMANENTLY" || place.businessStatus === "CLOSED_TEMPORARILY") continue;
            // Google treats the query's city as a hint, not a boundary —
            // drop places outside the searched province/state, or outside
            // the requested city when one was given.
            const candidate = candidateFromPlace(place, params, city);
            if (!isInSearchedRegion(candidate, params)) continue;
            if (params.cities.length > 0 && !placeIsInCity(place.addressComponents, city)) continue;
            results.push(candidate);
          }

          if (!data.nextPageToken) break;
          pageToken = data.nextPageToken;
          if (page < MAX_PAGES_PER_CITY - 1 && this.pageDelayMs > 0) await sleep(this.pageDelayMs);
        }
      }

      await onProgress?.({ kind: "city", city, cityIndex, totalCities: cities.length, foundSoFar: results.length });
    }

    return results;
  }
}
