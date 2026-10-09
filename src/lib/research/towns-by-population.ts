import "server-only";
import populationData from "./population-data.json";

// Built by scripts/build-population-data.ts from the census files; kept
// server-side, since the whole list would be a large download for the form.
type PopulationData = { sources: Record<string, string> } & Record<string, Record<string, [string, number][]>>;
const DATA = populationData as unknown as PopulationData;

export type TownsByPopulation = { towns: { name: string; population: number }[]; totalMatches: number; source: string };

/** The towns in a province or state with a population from min to max
 * (either may be left off), largest first, up to `limit`. */
export function findTownsByPopulation(country: string, region: string, min: number | null, max: number | null, limit: number): TownsByPopulation {
  const all = DATA[country]?.[region.toUpperCase()] ?? [];
  const matches = all.filter(([, population]) => (min === null || population >= min) && (max === null || population <= max));
  return {
    towns: matches.slice(0, limit).map(([name, population]) => ({ name, population })),
    totalMatches: matches.length,
    source: DATA.sources[country] ?? "",
  };
}
