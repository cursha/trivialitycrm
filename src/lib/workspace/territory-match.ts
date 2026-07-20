import type { Prisma } from "../../generated/prisma/client";

// Territory matching is computed here, at read time, rather than stored as
// a territoryId FK on Company — see the Territory model's doc comment in
// schema.prisma for why. Matching and building a filter clause are kept as
// separate small pure(ish) functions so each is independently testable.

export type TerritoryCandidate = {
  id: string;
  name: string | null;
  country: string;
  region: string | null;
  city: string | null;
};

export type CompanyLocation = {
  country: string;
  region: string;
  city: string;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Picks the single best-matching territory for a company's location.
 * Overlap is resolved by specificity, most specific first: a city-level
 * territory (country+region+city all set) beats a region-level territory
 * (city null) beats a country-level territory (region and city both null).
 * Exact-duplicate scopes are impossible by construction — Territory has a
 * DB-level `@@unique([country, region, city])` constraint — so at most one
 * candidate can exist at each specificity level; this function still picks
 * the first found defensively. `territories` must already be filtered to
 * `active: true` by the caller.
 */
export function matchTerritory(location: CompanyLocation, territories: TerritoryCandidate[]): TerritoryCandidate | null {
  const loc = { country: normalize(location.country), region: normalize(location.region), city: normalize(location.city) };

  let cityMatch: TerritoryCandidate | null = null;
  let regionMatch: TerritoryCandidate | null = null;
  let countryMatch: TerritoryCandidate | null = null;

  for (const territory of territories) {
    if (normalize(territory.country) !== loc.country) continue;

    if (territory.region === null) {
      countryMatch ??= territory;
      continue;
    }
    if (normalize(territory.region) !== loc.region) continue;

    if (territory.city === null) {
      regionMatch ??= territory;
      continue;
    }
    if (normalize(territory.city) !== loc.city) continue;

    cityMatch ??= territory;
  }

  return cityMatch ?? regionMatch ?? countryMatch;
}

/** Turns a territory's scope back into a Company WHERE clause, for
 * "filter the pipeline/lead lists by territory" — case-insensitive to
 * match the existing country/region/city filter convention in
 * companies/queries.ts. */
export function territoryWhereClause(territory: {
  country: string;
  region: string | null;
  city: string | null;
}): Prisma.CompanyWhereInput {
  const clause: Prisma.CompanyWhereInput = { country: { equals: territory.country, mode: "insensitive" } };
  if (territory.region !== null) {
    clause.region = { equals: territory.region, mode: "insensitive" };
  }
  if (territory.city !== null) {
    clause.city = { equals: territory.city, mode: "insensitive" };
  }
  return clause;
}
