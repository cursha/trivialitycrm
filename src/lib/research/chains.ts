// No `import "server-only"` and only relative imports — run-search.ts calls
// this from the worker, under plain tsx (see src/lib/prisma.ts).
import { prisma } from "../prisma";
import { normalizeCompanyName } from "../duplicates/normalize";
import type { ResearchCandidate } from "./providers/types";

/**
 * Quick Search leaves chains and franchises out unless "Include chains and
 * franchises" is ticked (Curt's call: head office usually decides for them,
 * so they're rarely worth a rep's call). Google's directory doesn't say
 * whether a place is a chain, so a place counts as one when any of these
 * hold:
 * - its name starts with a known bar/restaurant chain's (KNOWN_CHAINS)
 * - its website is a page on a chain's location finder ("/locations/milton")
 * - its name is shared by CHAIN_MIN_LOCATIONS+ active companies in the CRM,
 *   the same rule as the sweet spot (src/lib/companies/sweet-spot.ts)
 * - its name turns up at CHAIN_MIN_LOCATIONS+ addresses in this one search
 */
export const CHAIN_MIN_LOCATIONS = 3;

// Normalized (normalizeCompanyName) as Google lists them. Each matches the
// whole name or its start up to a word break, so "Boston Pizza Milton"
// matches "boston pizza". Names an independent pub could share ("The Keg",
// "Earl's", "Casey's", "Fox and Hound") are only listed in their chain's
// fuller form.
const KNOWN_CHAINS = [
  // Canada
  "boston pizza",
  "kelseys",
  "montanas bbq",
  "jack astors",
  "east side marios",
  "moxies",
  "earls kitchen",
  "cactus club",
  "the keg steakhouse",
  "milestones",
  "shoeless joes",
  "st louis bar grill",
  "wild wing",
  "crabby joes",
  "lone star texas grill",
  "turtle jacks",
  "symposium cafe",
  "chucks roadhouse",
  "original joes",
  "browns socialhouse",
  "joey",
  "craft beer market",
  "fionn maccools",
  "elephant castle",
  "philthy mcnastys",
  "beertown",
  "the rec room",
  "mr mikes",
  "doolys",
  "state main",
  "the canadian brewhouse",
  // United States
  "applebees",
  "chilis",
  "tgi fridays",
  "buffalo wild wings",
  "hooters",
  "twin peaks",
  "old chicago",
  "yard house",
  "bjs restaurant",
  "millers ale house",
  "world of beer",
  "tilted kilt",
  "texas roadhouse",
  "outback steakhouse",
  "red robin",
  "dave busters",
  "topgolf",
  "bar louie",
  "rock bottom",
  "gordon biersch",
  "famous daves",
  "ruby tuesday",
  "walk ons",
  "duffys sports grill",
  "buffalo wings rings",
  "bad daddys burger",
  "beef o bradys",
  "native grill wings",
  "smokey bones",
  "lazy dog restaurant",
  "cheddars",
  "hurricane grill wings",
  "glory days grill",
];

// A chain's website path for one location: /locations/milton,
// /store/123, /restaurants/oakville-on. An independent's site is almost
// always just its home page.
const LOCATION_PAGE = /\/(locations?|stores?|restaurants?|store-locator|find-us)\/[^/?#]+/i;

function matchesKnownChain(normalizedName: string): boolean {
  // The Firkin pubs each have their own name ("Firkin on King", "The Bow
  // & Arrow Firkin"), so the word anywhere marks one.
  if (/\bfirkin\b/.test(normalizedName)) return true;
  return KNOWN_CHAINS.some((chain) => normalizedName === chain || normalizedName.startsWith(`${chain} `));
}

function isLocationPage(websiteUrl: string | null): boolean {
  if (!websiteUrl) return false;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
    return LOCATION_PAGE.test(new URL(withScheme).pathname);
  } catch {
    return false;
  }
}

/** Splits found places into the ones kept and the chains left out.
 * `crmChainNames`: normalized names shared by CHAIN_MIN_LOCATIONS+ active
 * companies. Pure, so it's testable without a database. */
export function separateChains<T extends Pick<ResearchCandidate, "name" | "websiteUrl" | "address1" | "city">>(
  candidates: T[],
  crmChainNames: Set<string>,
): { kept: T[]; chains: T[] } {
  // Addresses per name within this search: three locations of the same
  // name is a chain even when nothing else knows it.
  const addressesByName = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const name = normalizeCompanyName(candidate.name);
    const addresses = addressesByName.get(name) ?? new Set<string>();
    addresses.add(`${candidate.address1 ?? ""}|${candidate.city}`.toLowerCase());
    addressesByName.set(name, addresses);
  }

  const kept: T[] = [];
  const chains: T[] = [];
  for (const candidate of candidates) {
    const name = normalizeCompanyName(candidate.name);
    const isChain =
      matchesKnownChain(name) ||
      isLocationPage(candidate.websiteUrl) ||
      crmChainNames.has(name) ||
      (addressesByName.get(name)?.size ?? 0) >= CHAIN_MIN_LOCATIONS;
    (isChain ? chains : kept).push(candidate);
  }
  return { kept, chains };
}

/** Normalized names shared by CHAIN_MIN_LOCATIONS+ active companies. */
export async function getCrmChainNames(): Promise<Set<string>> {
  const groups = await prisma.company.groupBy({
    by: ["normalizedName"],
    where: { status: "ACTIVE" },
    _count: { _all: true },
    having: { normalizedName: { _count: { gte: CHAIN_MIN_LOCATIONS } } },
  });
  return new Set(groups.map((group) => group.normalizedName));
}
