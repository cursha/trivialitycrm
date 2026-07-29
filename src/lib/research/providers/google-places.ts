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

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

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

type PlaceAddressComponent = { longText?: string; shortText?: string; types?: string[] };

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

function extractPostalCode(addressComponents: PlaceAddressComponent[] | undefined): string | null {
  const component = addressComponents?.find((c) => c.types?.includes("postal_code"));
  return component?.longText ?? component?.shortText ?? null;
}

function componentText(component: PlaceAddressComponent | undefined): string | undefined {
  return component?.longText ?? component?.shortText ?? undefined;
}

// formattedAddress is the whole "123 Main St, Springfield, IL 62704, USA"
// string — city/region/postalCode/country are already their own
// ResearchCandidate fields, so address1 must hold only the street portion.
// Built from addressComponents (already requested for extractPostalCode)
// rather than string-splitting formattedAddress, which is locale-dependent.
// Falls back to formattedAddress on the rare place with no street_number/
// route components (e.g. a location known only by name) rather than null.
function extractStreetAddress(addressComponents: PlaceAddressComponent[] | undefined, fallback: string | null): string | null {
  const streetNumber = componentText(addressComponents?.find((c) => c.types?.includes("street_number")));
  const route = componentText(addressComponents?.find((c) => c.types?.includes("route")));
  const street = [streetNumber, route].filter(Boolean).join(" ");
  if (!street) return fallback;
  const subpremise = componentText(addressComponents?.find((c) => c.types?.includes("subpremise")));
  return subpremise ? `${street} ${subpremise}` : street;
}

function candidateFromPlace(place: NonNullable<PlacesTextSearchResult["places"]>[number], params: DiscoverParams, city: string): ResearchCandidate {
  return {
    name: place.displayName?.text ?? "Unknown business",
    address1: extractStreetAddress(place.addressComponents, place.formattedAddress ?? null),
    city,
    region: params.region,
    postalCode: extractPostalCode(place.addressComponents),
    country: params.country,
    phone: place.nationalPhoneNumber ?? null,
    email: null,
    websiteUrl: place.websiteUri ?? null,
    contactData: null,
    // A business directory has no way to know this — left honestly
    // UNCERTAIN rather than guessed. See results-table.tsx's "Research this
    // business" action for how a user opts into finding out.
    triviaStatus: "UNCERTAIN",
    competitorName: null,
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
      const query = `${params.leadTypeName} in ${city}, ${params.region}, ${params.country}`;
      let pageToken: string | undefined;

      for (let page = 0; page < MAX_PAGES_PER_CITY; page++) {
        // Per Google's docs, every field besides maxResultCount/pageSize/
        // pageToken must stay identical across pages of the same search.
        const body: { textQuery: string; pageToken?: string } = { textQuery: query };
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
          results.push(candidateFromPlace(place, params, city));
        }

        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
        if (page < MAX_PAGES_PER_CITY - 1 && this.pageDelayMs > 0) await sleep(this.pageDelayMs);
      }

      await onProgress?.({ city, cityIndex, totalCities: cities.length, foundSoFar: results.length });
    }

    return results;
  }
}
