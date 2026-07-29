// One-off cleanup for PotentialDuplicate rows created before the
// company-match.ts/contact-match.ts fix that stopped "same city+region"
// (companies) or "same company" (contacts) from being sufficient, on
// their own, to flag a pair as a potential duplicate. That fix only
// prevents NEW false positives going forward — nothing in the scan ever
// re-checks or clears an EXISTING PENDING/DEFERRED row whose score has
// since dropped to 0 under the corrected logic, so pre-fix false
// positives stay in the review queue indefinitely until this is run.
//
// Only touches PENDING and DEFERRED rows — never CONFIRMED (a human
// already decided it's a duplicate), NOT_DUPLICATE (already excluded from
// re-flagging by the scan's own snapshot-diff logic), or MERGED (already
// resolved). A row whose current score is 0 is deleted outright (it never
// should have been flagged); a row whose score changed but is still >0 has
// its score/confidence/reasons/matchedFields refreshed to match current
// logic, exactly as a normal rescan would.
//
// Dry-run by default. Nothing is written unless --apply is passed.
//
// Usage:
//   npx tsx scripts/clean-stale-duplicate-flags.ts            (dry run)
//   npx tsx scripts/clean-stale-duplicate-flags.ts --apply     (writes the changes)

import { prisma } from "../src/lib/prisma";
import { scoreCompanyMatch, type CompanyMatchInput } from "../src/lib/data-quality/company-match";
import { scoreContactMatch, type ContactMatchInput } from "../src/lib/data-quality/contact-match";
import { RuleConfigSchemas } from "../src/lib/data-quality/rules";

const COMPANY_SELECT = {
  id: true,
  name: true,
  normalizedName: true,
  address1: true,
  city: true,
  region: true,
  country: true,
  postalCode: true,
  normalizedRegion: true,
  normalizedCity: true,
  normalizedPostalCode: true,
  phone: true,
  normalizedPhone: true,
  email: true,
  normalizedEmail: true,
  websiteUrl: true,
  websiteDomain: true,
} as const;

const CONTACT_SELECT = {
  id: true,
  companyId: true,
  firstName: true,
  lastName: true,
  normalizedFirstName: true,
  normalizedLastName: true,
  phone: true,
  normalizedPhone: true,
  email: true,
  normalizedEmail: true,
} as const;

async function main() {
  const apply = process.argv.includes("--apply");

  const fuzzyRule = await prisma.dataQualityRule.findFirst({ where: { ruleType: "DUPLICATE_FUZZY_MATCH" } });
  const minFuzzySimilarity = fuzzyRule ? RuleConfigSchemas.DUPLICATE_FUZZY_MATCH.parse(fuzzyRule.config ?? {}).minSimilarity : 100;

  const rows = await prisma.potentialDuplicate.findMany({
    where: { status: { in: ["PENDING", "DEFERRED"] } },
  });

  console.log(`Checked ${rows.length} PENDING/DEFERRED potential duplicate(s).`);

  let cleared = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedMissing = 0;

  for (const row of rows) {
    let newScore: number;
    let result: { score: number; confidence: "HIGH" | "MEDIUM" | "LOW"; reasons: string[]; matchedFields: string[]; conflictingFields: string[] };
    let label: string;

    if (row.entityType === "COMPANY") {
      if (!row.companyAId || !row.companyBId) continue;
      const [a, b] = await Promise.all([
        prisma.company.findUnique({ where: { id: row.companyAId }, select: COMPANY_SELECT }),
        prisma.company.findUnique({ where: { id: row.companyBId }, select: COMPANY_SELECT }),
      ]);
      if (!a || !b) {
        skippedMissing++;
        continue;
      }
      result = scoreCompanyMatch(a as CompanyMatchInput, b as CompanyMatchInput, minFuzzySimilarity);
      newScore = result.score;
      label = `${a.name} <-> ${b.name}`;
    } else {
      if (!row.contactAId || !row.contactBId) continue;
      const [a, b] = await Promise.all([
        prisma.contact.findUnique({ where: { id: row.contactAId }, select: CONTACT_SELECT }),
        prisma.contact.findUnique({ where: { id: row.contactBId }, select: CONTACT_SELECT }),
      ]);
      if (!a || !b) {
        skippedMissing++;
        continue;
      }
      result = scoreContactMatch(a as ContactMatchInput, b as ContactMatchInput, minFuzzySimilarity);
      newScore = result.score;
      label = `${a.firstName} ${a.lastName} <-> ${b.firstName} ${b.lastName}`;
    }

    if (newScore === 0) {
      cleared++;
      console.log(`\nCLEAR (score ${row.score} -> 0): ${label} [${row.id}]`);
      if (apply) {
        await prisma.potentialDuplicate.delete({ where: { id: row.id } });
      }
    } else if (newScore !== row.score) {
      updated++;
      console.log(`\nUPDATE (score ${row.score} -> ${newScore}): ${label} [${row.id}]`);
      if (apply) {
        await prisma.potentialDuplicate.update({
          where: { id: row.id },
          data: {
            score: result.score,
            confidence: result.confidence,
            reasons: result.reasons,
            matchedFields: result.matchedFields,
            conflictingFields: result.conflictingFields,
          },
        });
      }
    } else {
      unchanged++;
    }
  }

  console.log(
    `\n${cleared} would be cleared, ${updated} would be updated, ${unchanged} unchanged, ${skippedMissing} skipped (missing record).`,
  );
  console.log(apply ? "Applied." : "Dry run only -- nothing was written. Re-run with --apply to write these changes.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
