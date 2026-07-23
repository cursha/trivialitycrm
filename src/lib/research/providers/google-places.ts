// Fast, cheap business-directory discovery for GENERAL-mode lead searches —
// see src/lib/research/providers/factory.ts for why this only ever backs
// GENERAL mode. Not an AI call: no web_search/web_fetch tool use, no
// checkAiBudget() gate, no AiUsageRecord tracking (that model is scoped to
// Anthropic operations). One Places "Text Search (New)" request per city,
// field-masked to the cheapest SKU tier that still includes phone/website.
// Real pricing research found Text Search + phone/website lands in Google's
// "Enterprise" SKU, ~$0.035/call, with a real monthly free allowance that
// very likely covers this app's actual usage entirely.
import { getEnv } from "../../env";
import type { CandidateDiscoveryProvider, DiscoverParams, ResearchCandidate } from "./types";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Only the fields this app actually stores — requesting anything from the
// Atmosphere tier (rating, reviews, price level) would push every call into
// a more expensive SKU for data nothing here displays.
const FIELD_MASK = ["places.displayName", "places.formattedAddress", "places.nationalPhoneNumber", "places.websiteUri", "places.businessStatus"].join(",");

type PlacesTextSearchResult = {
  places?: {
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
  }[];
};

function candidateFromPlace(place: NonNullable<PlacesTextSearchResult["places"]>[number], params: DiscoverParams, city: string): ResearchCandidate {
  return {
    name: place.displayName?.text ?? "Unknown business",
    address1: place.formattedAddress ?? null,
    city,
    region: params.region,
    postalCode: null,
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
  async discover(params: DiscoverParams): Promise<ResearchCandidate[]> {
    const { GOOGLE_PLACES_API_KEY } = getEnv();
    if (!GOOGLE_PLACES_API_KEY) {
      throw new Error("GOOGLE_PLACES_API_KEY is not set — required to use the Google Places discovery provider.");
    }

    const cities = params.cities.length > 0 ? params.cities : [params.region];
    const results: ResearchCandidate[] = [];

    for (const city of cities) {
      const query = `${params.leadTypeName} in ${city}, ${params.region}, ${params.country}`;

      const response = await fetch(TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({ textQuery: query }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Google Places Text Search failed (${response.status}) for "${city}": ${body.slice(0, 300)}`);
      }

      const data = (await response.json()) as PlacesTextSearchResult;
      for (const place of data.places ?? []) {
        if (place.businessStatus === "CLOSED_PERMANENTLY" || place.businessStatus === "CLOSED_TEMPORARILY") continue;
        results.push(candidateFromPlace(place, params, city));
      }
    }

    return results;
  }
}
