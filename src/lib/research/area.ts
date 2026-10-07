// Relative imports only, like the rest of src/lib/research (runs in the
// worker as well as the web app).
import { normalizeCountry, normalizeRegion } from "../data-quality/normalize";

/**
 * Keeps a search to the area that was asked for (Curt hit pubs from outside
 * his city and province in his results). Neither source respects the area on
 * its own: Google Places Text Search treats "Pub in Mississauga, ON" as a
 * hint, not a boundary, and the AI wanders without a firm rule.
 */

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Same country and province/state as the search. A blank value can't be
 * checked, so it passes. */
export function isInSearchedRegion(candidate: { country: string; region: string }, search: { country: string; region: string }): boolean {
  if (candidate.country.trim() && normalizeCountry(candidate.country) !== normalizeCountry(search.country)) return false;
  const searchedRegion = normalizeRegion(search.region, search.country);
  const candidateRegion = normalizeRegion(candidate.region, candidate.country || search.country);
  return !searchedRegion || !candidateRegion || candidateRegion === searchedRegion;
}

/**
 * A Google place is in a requested city when the city is its locality or any
 * smaller or alternate name Google gives it (sublocality, neighbourhood,
 * postal town, municipality) — so "Scarborough" still matches a place
 * Google files under Toronto. A place with none of those can't be checked,
 * so it passes.
 */
const CITY_COMPONENT_TYPES = ["locality", "sublocality", "sublocality_level_1", "neighborhood", "postal_town", "administrative_area_level_3"];

export function placeIsInCity(components: { longText?: string; shortText?: string; types?: string[] }[] | undefined, city: string): boolean {
  const names = (components ?? [])
    .filter((component) => component.types?.some((type) => CITY_COMPONENT_TYPES.includes(type)))
    .flatMap((component) => [component.longText, component.shortText])
    .filter((name): name is string => !!name);
  return names.length === 0 || names.some((name) => sameText(name, city));
}
