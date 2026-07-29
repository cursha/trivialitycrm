// One-off backfill for city/region casing saved before the transfer/search
// steps started normalizing them (see TransferRowSchema/SearchSetupSchema/
// QuickSearchSetupSchema/CompanySchema/region.ts) — directory/AI lead-gen
// sources and manual entry return inconsistent casing (all-caps,
// all-lowercase city; lowercase region), and rows written before that fix
// still carry it as-is. Covers both Company (already-transferred leads) and
// SearchResult (not-yet-transferred search results, which also display
// city/region in the UI).
//
// Convention: region is ALWAYS a 2-letter state/province code, uppercase
// (e.g. "ON", "CO") -- anything else (a full name like "Colorado", or a
// city name that ended up in the region column) is not a casing bug, it's
// garbage data this script refuses to guess at fixing; it's reported
// separately instead of being touched. city is always title case (e.g.
// "Milton"). A row whose city IS the (valid, 2-letter) region code is a
// leftover region-as-city placeholder from a pre-fix Google Places bug (see
// google-places.ts's extractCity()), not a real city name, so it's
// uppercased like a region instead of title-cased like a city.
//
// Only ever changes casing -- never touches the normalizedCity/
// normalizedRegion columns, since normalizeCity()/normalizeRegion()
// (src/lib/data-quality/normalize.ts) already case-fold their input, so a
// casing-only change here can never affect them.
//
// Dry-run by default. Nothing is written unless --apply is passed.
//
// Usage:
//   npx tsx --env-file=.env scripts/fix-city-casing.ts            (dry run, prints every proposed change)
//   npx tsx --env-file=.env scripts/fix-city-casing.ts --apply     (writes the changes)

import { prisma } from "../src/lib/prisma";
import { titleCaseCity } from "../src/lib/text-case";

type Row = { id: string; name: string; city: string; region: string };

function fixCity(city: string, region: string): string {
  // A 2-letter city that literally equals the (valid) region code is a
  // leftover region-as-city placeholder, not a real city name.
  if (city.length === 2 && region.length === 2 && city.toUpperCase() === region.toUpperCase()) return city.toUpperCase();
  return titleCaseCity(city);
}

async function processRows(label: string, rows: Row[], update: (id: string, data: { city: string; region: string }) => Promise<unknown>, apply: boolean) {
  let changed = 0;
  const garbage: Row[] = [];

  for (const row of rows) {
    if (row.region.length !== 2) {
      garbage.push(row);
      continue;
    }
    const fixedCity = fixCity(row.city, row.region);
    const fixedRegion = row.region.toUpperCase();
    if (fixedCity === row.city && fixedRegion === row.region) continue;

    changed++;
    console.log(`${label} "${row.name}" (${row.id}): city "${row.city}" -> "${fixedCity}", region "${row.region}" -> "${fixedRegion}"`);
    if (apply) await update(row.id, { city: fixedCity, region: fixedRegion });
  }

  return { changed, garbage };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const companies = await prisma.company.findMany({ select: { id: true, name: true, city: true, region: true } });
  const searchResults = await prisma.searchResult.findMany({ select: { id: true, name: true, city: true, region: true } });

  const companyResult = await processRows(
    "Company",
    companies,
    (id, data) => prisma.company.update({ where: { id }, data }),
    apply,
  );
  const searchResultResult = await processRows(
    "SearchResult",
    searchResults,
    (id, data) => prisma.searchResult.update({ where: { id }, data }),
    apply,
  );

  const total = companies.length + searchResults.length;
  const changed = companyResult.changed + searchResultResult.changed;
  const garbage = [...companyResult.garbage, ...searchResultResult.garbage];

  console.log(`\n${changed} of ${total} row(s) would ${apply ? "be" : "be"} changed.`);
  console.log(apply ? "Applied." : "Dry run only -- nothing was written. Re-run with --apply to write these changes.");

  if (garbage.length > 0) {
    console.log(`\n${garbage.length} row(s) have a region that isn't a 2-letter code -- NOT touched, needs manual review:`);
    for (const row of garbage) console.log(`  ${row.name} (${row.id}): region "${row.region}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
