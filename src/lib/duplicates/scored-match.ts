// Confidence-tiered duplicate matching for Competition Locator. Reuses
// scoreCompanyMatch() (src/lib/data-quality/company-match.ts) rather than
// the coarser findPotentialDuplicates() (./match.ts), which only returns a
// matched-field list with no confidence tier — Competition Locator's review
// screen needs HIGH/MEDIUM/LOW to bucket results (see
// src/lib/research/competition-locator-buckets.ts). Computed once at
// discovery time (run-search.ts) and persisted on SearchResult.duplicateMatches,
// not recomputed on every review-page load of a long-lived review session.
import type { PrismaClient } from "../../generated/prisma/client";
import { normalizeCompanyName, normalizePhone, normalizeEmail, extractWebsiteDomain } from "./normalize";
import { computeAddressNormalizedFields } from "../data-quality/normalize";
import { scoreCompanyMatch, type CompanyMatchInput, type MatchScoreResult } from "../data-quality/company-match";

export type ScoredDuplicateInput = {
  name: string;
  address1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  websiteUrl?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type ScoredDuplicateMatch = {
  companyId: string;
  companyName: string;
} & MatchScoreResult;

const MAX_MATCHES = 5;

/**
 * Finds and scores likely-duplicate ACTIVE companies for a freshly
 * discovered venue. Shortlists candidates via the same exact-signal OR
 * (normalized name/website domain/phone/email) findPotentialDuplicates()
 * uses, plus a same-city+region pass so a venue whose name has drifted
 * slightly (abbreviation, location suffix, punctuation) from what's already
 * on file still surfaces as a candidate for scoreCompanyMatch()'s fuzzy-name
 * signal to evaluate — that fuzzy pass alone never contributes a strong
 * signal (see company-match.ts), it only widens the shortlist. Returns the
 * top 5 matches by score, highest first; empty when nothing matched at all.
 */
export async function findScoredDuplicateMatches(
  prisma: Pick<PrismaClient, "company">,
  input: ScoredDuplicateInput,
  options?: { excludeCompanyId?: string },
): Promise<ScoredDuplicateMatch[]> {
  const normalizedName = normalizeCompanyName(input.name);
  const normalizedPhone = input.phone ? normalizePhone(input.phone) : null;
  const normalizedEmail = input.email ? normalizeEmail(input.email) : null;
  const websiteDomain = input.websiteUrl ? extractWebsiteDomain(input.websiteUrl) : null;
  const { normalizedCity, normalizedRegion, normalizedPostalCode } = computeAddressNormalizedFields(input);

  const orConditions: Record<string, unknown>[] = [{ normalizedName }];
  if (websiteDomain) orConditions.push({ websiteDomain });
  if (normalizedPhone) orConditions.push({ normalizedPhone });
  if (normalizedEmail) orConditions.push({ normalizedEmail });
  if (normalizedCity && normalizedRegion) orConditions.push({ normalizedCity, normalizedRegion });

  const candidates = await prisma.company.findMany({
    where: {
      OR: orConditions,
      status: "ACTIVE",
      ...(options?.excludeCompanyId ? { id: { not: options.excludeCompanyId } } : {}),
    },
    select: {
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
    },
  });

  const candidateInput: CompanyMatchInput = {
    id: "",
    name: input.name,
    normalizedName,
    address1: input.address1 ?? null,
    city: input.city ?? "",
    region: input.region ?? "",
    country: input.country ?? "",
    postalCode: input.postalCode ?? null,
    normalizedRegion,
    normalizedCity,
    normalizedPostalCode,
    phone: input.phone ?? null,
    normalizedPhone,
    email: input.email ?? null,
    normalizedEmail,
    websiteUrl: input.websiteUrl ?? null,
    websiteDomain,
  };

  return candidates
    .map((company) => ({ companyId: company.id, companyName: company.name, ...scoreCompanyMatch(candidateInput, company) }))
    .filter((match) => match.matchedFields.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHES);
}
