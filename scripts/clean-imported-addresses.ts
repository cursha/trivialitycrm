// One-off cleanup for companies imported from a spreadsheet whose "Address"
// column already contained the full address (street + city + region +
// postal + country), while separate City/Region columns repeated the same
// info — so Company.address1 ended up with the city/region/country
// redundantly baked in on top of the real city/region columns.
//
// Conservative by design: only touches a row when city AND region are both
// found, case-insensitively, as whole-word matches inside address1 (never a
// coincidental substring like "Ontario Street" partially matching region
// "ON"), and only strips from that match point onward -- it never touches
// anything before the match, so a genuinely correct short address1 is never
// altered.
//
// Dry-run by default. Nothing is written unless --apply is passed.
//
// Usage:
//   npx tsx scripts/clean-imported-addresses.ts            (dry run, prints every proposed change)
//   npx tsx scripts/clean-imported-addresses.ts --apply     (writes the changes)
//   npx tsx scripts/clean-imported-addresses.ts --apply --batch=<importBatchId>   (scope to one import)

import { prisma } from "../src/lib/prisma";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds the redundant city/region tail in address1 and returns the cleaned
 * street-only prefix, or null if this row doesn't match the pattern (left
 * untouched either way).
 */
function cleanAddress1(address1: string, city: string, region: string): string | null {
  if (!city.trim() || !region.trim()) return null;

  // Word-boundary match so "ON" doesn't accidentally match inside "Iron
  // Street", and city name matches whole, not as a substring of a longer
  // word.
  const cityPattern = new RegExp(`\\b${escapeRegExp(city.trim())}\\b`, "i");
  const cityMatch = cityPattern.exec(address1);
  if (!cityMatch) return null;

  const regionPattern = new RegExp(`\\b${escapeRegExp(region.trim())}\\b`, "i");
  const afterCity = address1.slice(cityMatch.index);
  if (!regionPattern.test(afterCity)) return null;

  // Everything before the city match is the real street address. Trim any
  // trailing comma/whitespace left over from the join.
  const cleaned = address1.slice(0, cityMatch.index).replace(/[\s,]+$/, "").trim();

  // Sanity checks: don't produce an empty address1, and don't "clean"
  // something that wasn't actually shortened (would indicate the city name
  // matched right at the start, i.e. address1 IS just the city -- leave
  // those alone for a human to look at).
  if (!cleaned || cleaned.length >= address1.length) return null;

  return cleaned;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const batchArg = process.argv.find((a) => a.startsWith("--batch="));
  const importBatchId = batchArg?.split("=")[1];

  const companies = await prisma.company.findMany({
    where: {
      address1: { not: null },
      ...(importBatchId ? { importBatchId } : { source: "IMPORT" }),
    },
    select: { id: true, name: true, address1: true, city: true, region: true },
  });

  console.log(`Checked ${companies.length} imported compan${companies.length === 1 ? "y" : "ies"} with an address1 set.`);

  let changed = 0;
  for (const company of companies) {
    const cleaned = cleanAddress1(company.address1!, company.city, company.region);
    if (cleaned === null) continue;

    changed++;
    console.log(`\n${company.name} (${company.id})`);
    console.log(`  before: ${company.address1}`);
    console.log(`  after:  ${cleaned}`);

    if (apply) {
      await prisma.company.update({ where: { id: company.id }, data: { address1: cleaned } });
    }
  }

  console.log(`\n${changed} of ${companies.length} would ${apply ? "be" : "be"} changed.`);
  console.log(apply ? "Applied." : "Dry run only -- nothing was written. Re-run with --apply to write these changes.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
