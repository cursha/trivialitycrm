// One-off backfill for city names saved before the transfer step started
// title-casing them (see TransferRowSchema in src/lib/validation/transfer.ts)
// — directory/AI lead-gen sources return inconsistent casing (all-caps,
// all-lowercase), and rows written before that fix still carry it as-is.
// Covers both Company (already-transferred leads) and SearchResult
// (not-yet-transferred search results, which also display city in the UI).
//
// Only ever changes casing via titleCaseCity() — never touches the
// normalizedCity column, since normalizeCity() (src/lib/data-quality/
// normalize.ts) already case-folds its input, so a casing-only change here
// can never affect it.
//
// Dry-run by default. Nothing is written unless --apply is passed.
//
// Usage:
//   npx tsx scripts/fix-city-casing.ts            (dry run, prints every proposed change)
//   npx tsx scripts/fix-city-casing.ts --apply     (writes the changes)

import { prisma } from "../src/lib/prisma";
import { titleCaseCity } from "../src/lib/text-case";

async function main() {
  const apply = process.argv.includes("--apply");
  let changed = 0;
  let total = 0;

  const companies = await prisma.company.findMany({ select: { id: true, name: true, city: true } });
  total += companies.length;
  for (const company of companies) {
    const fixed = titleCaseCity(company.city);
    if (fixed === company.city) continue;
    changed++;
    console.log(`Company "${company.name}" (${company.id}): "${company.city}" -> "${fixed}"`);
    if (apply) await prisma.company.update({ where: { id: company.id }, data: { city: fixed } });
  }

  const searchResults = await prisma.searchResult.findMany({ select: { id: true, name: true, city: true } });
  total += searchResults.length;
  for (const result of searchResults) {
    const fixed = titleCaseCity(result.city);
    if (fixed === result.city) continue;
    changed++;
    console.log(`SearchResult "${result.name}" (${result.id}): "${result.city}" -> "${fixed}"`);
    if (apply) await prisma.searchResult.update({ where: { id: result.id }, data: { city: fixed } });
  }

  console.log(`\n${changed} of ${total} row(s) would ${apply ? "be" : "be"} changed.`);
  console.log(apply ? "Applied." : "Dry run only -- nothing was written. Re-run with --apply to write these changes.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
