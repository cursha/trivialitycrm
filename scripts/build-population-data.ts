/**
 * Builds src/lib/research/population-data.json, the towns and populations
 * behind Quick Search's "Find towns by population", from the official
 * census files. Rerun when a new census or estimate comes out:
 *
 *   npx tsx scripts/build-population-data.ts <statcan-98100002.csv> <statcan-98100002_MetaData.csv> <census-sub-est.csv>
 *
 * Canada: Statistics Canada table 98-10-0002-01, 2021 census population of
 * every census subdivision (municipality),
 * https://www150.statcan.gc.ca/n1/tbl/csv/98100002-eng.zip
 * United States: Census Bureau city and town population estimates,
 * https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(__dirname, "../src/lib/research/population-data.json");

// Small places are left out: a town under this many people rarely has a
// bar worth a search, and keeping them all would double the file.
const MIN_POPULATION = 500;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const CA_PROVINCES: Record<string, string> = {
  "10": "NL", "11": "PE", "12": "NS", "13": "NB", "24": "QC", "35": "ON", "46": "MB", "47": "SK", "48": "AB", "59": "BC", "60": "YT", "61": "NT", "62": "NU",
};

// Census subdivisions that aren't towns a rep would search: reserves and
// settlements, unorganized land, and electoral or fire districts.
const CA_EXCLUDED_TYPES = new Set([
  "Indian reserve",
  "Indian settlement",
  "Indian government district",
  "Unorganized",
  "Subdivision of unorganized",
  "Regional district electoral area",
  "Subdivision of county municipality",
  "Terres réservées aux Cris",
  "Terres réservées aux Naskapis",
  "Terre inuite",
  "Fire district",
  "Settlement",
  "Improvement district",
  "Special area",
]);

const US_STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME",
  Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

// Where towns and townships are the local government, not cities: New
// England towns and New Jersey/Pennsylvania townships cover ground no
// incorporated place does (Cherry Hill, NJ is one), so they're included
// there too. Elsewhere a township is mostly countryside around a town
// that's already listed.
const US_TOWNSHIP_STATES = new Set(["CT", "ME", "MA", "NH", "RI", "VT", "NJ", "PA"]);

/** "Boise City city" → "Boise City", "San Buenaventura (Ventura) city" →
 * "Ventura", "Athens-Clarke County unified government (balance)" →
 * "Athens": the name Google would file a place under. */
export function usPlaceName(censusName: string): string {
  const consolidated = /\((balance)\)$|government|urban county/.test(censusName);
  let name = censusName.replace(/ \(balance\)$/, "").replace(/( [a-z][a-z]*)+$/, "");
  const alias = /^.+ \((.+)\)$/.exec(name);
  if (alias) name = alias[1];
  if (consolidated) name = name.split(/[/-]/)[0];
  return name.trim();
}

type Towns = Record<string, Map<string, number>>;

// Two places with the same name in one province or state (Hamilton city
// and Hamilton township, ON) would search the same name, so keep the
// bigger one.
function add(towns: Towns, region: string, name: string, population: number) {
  if (!name || population < MIN_POPULATION) return;
  const byName = (towns[region] ??= new Map());
  const existing = [...byName.keys()].find((key) => key.toLowerCase() === name.toLowerCase());
  if (existing && byName.get(existing)! >= population) return;
  if (existing) byName.delete(existing);
  byName.set(name, population);
}

function buildCanada(dataPath: string, metaPath: string): Towns {
  // Each census subdivision's type and province, by DGUID, from the
  // metadata's geography attributes.
  const typeByMember = new Map<string, string>();
  const dguidByMember = new Map<string, string>();
  for (const row of parseCsv(readFileSync(metaPath, "utf8"))) {
    if (row[0] !== "1" || row.length < 7) continue;
    if (row[3] === "GEO_TYPE_DESC") typeByMember.set(row[1], row[6]);
    if (row[3] === "DGUID") dguidByMember.set(row[1], row[6]);
  }
  const typeByDguid = new Map([...dguidByMember].map(([member, dguid]) => [dguid, typeByMember.get(member) ?? ""]));

  const towns: Towns = {};
  const [header, ...rows] = parseCsv(readFileSync(dataPath, "utf8").replace(/^﻿/, ""));
  const populationColumn = header.findIndex((column) => column.includes("Population, 2021"));
  for (const row of rows) {
    const dguid = row[2] ?? "";
    // 2021A0005 + 7-digit code: a census subdivision; its first 2 digits
    // are the province.
    if (!/^2021A0005\d{7}$/.test(dguid)) continue;
    if (CA_EXCLUDED_TYPES.has(typeByDguid.get(dguid) ?? "")) continue;
    const province = CA_PROVINCES[dguid.slice(9, 11)];
    // Bilingual names ("Greater Sudbury / Grand Sudbury"): the first.
    const name = row[1].split(" / ")[0].trim();
    add(towns, province, name, Number(row[populationColumn]));
  }
  return towns;
}

function buildUnitedStates(dataPath: string): Towns {
  const towns: Towns = {};
  const [header, ...rows] = parseCsv(readFileSync(dataPath, "latin1"));
  const col = (name: string) => header.indexOf(name);
  const populationColumn = header.length - 1;
  for (const row of rows) {
    const state = US_STATES[row[col("STNAME")]];
    if (!state) continue;
    const level = row[col("SUMLEV")];
    const isPlace = level === "162";
    const isTownship = level === "061" && US_TOWNSHIP_STATES.has(state) && row[col("FUNCSTAT")] === "A";
    if (!isPlace && !isTownship) continue;
    add(towns, state, usPlaceName(row[col("NAME")]), Number(row[populationColumn]));
  }
  return towns;
}

function sorted(towns: Towns): Record<string, [string, number][]> {
  return Object.fromEntries(
    Object.keys(towns)
      .sort()
      .map((region) => [region, [...towns[region]].sort((a, b) => b[1] - a[1])]),
  );
}

if (typeof require !== "undefined" && require.main === module) {
  const [caData, caMeta, usData] = process.argv.slice(2);
  if (!caData || !caMeta || !usData) {
    console.error("Usage: npx tsx scripts/build-population-data.ts <98100002.csv> <98100002_MetaData.csv> <sub-est.csv>");
    process.exit(1);
  }
  const usHeader = parseCsv(readFileSync(usData, "latin1").split(/\r?\n/)[0])[0];
  const usYear = usHeader[usHeader.length - 1].replace("POPESTIMATE", "");
  const data = {
    sources: {
      Canada: "Statistics Canada, 2021 census",
      "United States": `U.S. Census Bureau, ${usYear} population estimates`,
    },
    Canada: sorted(buildCanada(caData, caMeta)),
    "United States": sorted(buildUnitedStates(usData)),
  };
  writeFileSync(OUT, JSON.stringify(data));
  for (const country of ["Canada", "United States"] as const) {
    const regions = data[country];
    console.log(`${country}: ${Object.keys(regions).length} regions, ${Object.values(regions).reduce((n, list) => n + list.length, 0)} towns`);
  }
}
