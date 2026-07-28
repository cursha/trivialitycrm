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
// IMPORTANT LESSON FROM THE FIRST VERSION OF THIS SCRIPT (confirmed live):
// the postal code was ONLY ever present as text embedded in address1 --
// Company.postalCode was never separately populated by the original import
// (same root cause as address1 itself: a single combined "Address" column
// was mapped in, with nothing mapped to a distinct postal-code field). The
// first version of this script stripped the matched tail (which is where
// the postal code lives -- between region and country) without extracting
// it first, silently discarding real data for every row it touched. This
// version extracts a postal code from the removed tail BEFORE discarding it
// and fills Company.postalCode with it -- fill-blank-only (never overwrites
// an existing value), same convention as Company.email elsewhere in this
// app. Rows already `--apply`'d with the old script are NOT recoverable by
// re-running this one: the postal code text is already gone from address1
// in the database, this can only prevent the loss on rows not yet touched.
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

// Canadian (A1A 1A1, with or without the space) and US ZIP (12345 or
// 12345-6789) formats -- this app only ever stores "USA"/"CA" as country
// values (confirmed with the account holder), so these two cover it.
const CA_POSTAL_CODE = /\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b/;
const US_ZIP_CODE = /\b\d{5}(-\d{4})?\b/;

function extractPostalCode(text: string): string | null {
  return (CA_POSTAL_CODE.exec(text) ?? US_ZIP_CODE.exec(text))?.[0]?.toUpperCase().replace(/\s+/g, " ") ?? null;
}

type CleanResult = { address1: string; extractedPostalCode: string | null };

/**
 * Finds the redundant city/region tail in address1 and returns the cleaned
 * street-only prefix plus any postal code recovered from the removed tail,
 * or null if this row doesn't match the pattern (left untouched either
 * way).
 */
function cleanAddress1(address1: string, city: string, region: string): CleanResult | null {
  if (!city.trim() || !region.trim()) return null;

  // Word-boundary match so "ON" doesn't accidentally match inside "Iron
  // Street", and city name matches whole, not as a substring of a longer
  // word.
  const cityPattern = new RegExp(`\\b${escapeRegExp(city.trim())}\\b`, "i");
  const cityMatch = cityPattern.exec(address1);
  if (!cityMatch) return null;

  const regionPattern = new RegExp(`\\b${escapeRegExp(region.trim())}\\b`, "i");
  const removedTail = address1.slice(cityMatch.index);
  if (!regionPattern.test(removedTail)) return null;

  // Everything before the city match is the real street address. Trim any
  // trailing comma/whitespace left over from the join.
  const cleaned = address1.slice(0, cityMatch.index).replace(/[\s,]+$/, "").trim();

  // Sanity checks: don't produce an empty address1, and don't "clean"
  // something that wasn't actually shortened (would indicate the city name
  // matched right at the start, i.e. address1 IS just the city -- leave
  // those alone for a human to look at).
  if (!cleaned || cleaned.length >= address1.length) return null;

  return { address1: cleaned, extractedPostalCode: extractPostalCode(removedTail) };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const batchArg = process.argv.find((a) => a.startsWith("--batch="));
  const importBatchId = batchArg?.split("=")[1];

  // Company.source is nullable and only populated going forward from when
  // that attribution field was added -- confirmed live that filtering on
  // source: "IMPORT" matched zero rows even though the affected companies
  // definitely exist, meaning they predate it and are just null. Scoping
  // by --batch=<importBatchId> still works (that FK is older/always set on
  // import), but the default now scans every company with an address1 --
  // safe regardless, since the real safety net is the conservative
  // city+region whole-word match below, not this filter.
  const companies = await prisma.company.findMany({
    where: {
      address1: { not: null },
      ...(importBatchId ? { importBatchId } : {}),
    },
    select: { id: true, name: true, address1: true, city: true, region: true, postalCode: true },
  });

  console.log(`Checked ${companies.length} compan${companies.length === 1 ? "y" : "ies"} with an address1 set.`);

  let changed = 0;
  let postalCodesRecovered = 0;
  for (const company of companies) {
    const result = cleanAddress1(company.address1!, company.city, company.region);
    if (result === null) continue;

    // Fill-blank-only -- never overwrites an existing postalCode, same
    // convention as Company.email elsewhere in this app.
    const fillPostalCode = !company.postalCode && result.extractedPostalCode ? result.extractedPostalCode : null;

    changed++;
    if (fillPostalCode) postalCodesRecovered++;
    console.log(`\n${company.name} (${company.id})`);
    console.log(`  address1 before: ${company.address1}`);
    console.log(`  address1 after:  ${result.address1}`);
    console.log(`  postalCode: ${company.postalCode ?? "(blank)"} ${fillPostalCode ? `-> ${fillPostalCode}` : "(unchanged)"}`);

    if (apply) {
      await prisma.company.update({
        where: { id: company.id },
        data: { address1: result.address1, ...(fillPostalCode ? { postalCode: fillPostalCode } : {}) },
      });
    }
  }

  console.log(`\n${changed} of ${companies.length} would ${apply ? "be" : "be"} changed, recovering ${postalCodesRecovered} postal code(s).`);
  console.log(apply ? "Applied." : "Dry run only -- nothing was written. Re-run with --apply to write these changes.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
