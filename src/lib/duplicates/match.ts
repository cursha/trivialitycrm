import type { PrismaClient } from "../../generated/prisma/client";
import type { CompanyStatus } from "../../generated/prisma/enums";
import { normalizeCompanyName, normalizePhone, normalizeEmail, extractWebsiteDomain, normalizeAddressLine } from "./normalize";

export type DuplicateCandidateInput = {
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

export type DuplicateMatchReason = "name" | "address" | "websiteDomain" | "phone" | "email";

export type DuplicateMatch = {
  id: string;
  name: string;
  city: string;
  region: string;
  status: CompanyStatus;
  matchedOn: DuplicateMatchReason[];
};

/**
 * Computes the normalized fields that should be written alongside a
 * Company record so future duplicate lookups (and this function itself)
 * can compare on them directly.
 */
export function computeNormalizedFields(input: DuplicateCandidateInput) {
  return {
    normalizedName: normalizeCompanyName(input.name),
    normalizedPhone: input.phone ? normalizePhone(input.phone) : null,
    normalizedEmail: input.email ? normalizeEmail(input.email) : null,
    websiteDomain: input.websiteUrl ? extractWebsiteDomain(input.websiteUrl) : null,
  };
}

/**
 * Finds companies that are likely duplicates of the given candidate, based
 * on normalized name, address, website domain, phone, and email. Reusable
 * by manual company creation, future AI-research transfer, and future
 * spreadsheet import — none of those flows should silently insert a company
 * that matches here.
 */
export async function findPotentialDuplicates(
  prisma: Pick<PrismaClient, "company">,
  input: DuplicateCandidateInput,
  options?: { excludeCompanyId?: string },
): Promise<DuplicateMatch[]> {
  const { normalizedName, normalizedPhone, normalizedEmail, websiteDomain } = computeNormalizedFields(input);
  const normalizedAddress = input.address1 ? normalizeAddressLine(input.address1) : null;

  const orConditions: Record<string, unknown>[] = [{ normalizedName }];

  if (websiteDomain) orConditions.push({ websiteDomain });
  if (normalizedPhone) orConditions.push({ normalizedPhone });
  if (normalizedEmail) orConditions.push({ normalizedEmail });

  const candidates = await prisma.company.findMany({
    where: {
      OR: orConditions,
      ...(options?.excludeCompanyId ? { id: { not: options.excludeCompanyId } } : {}),
    },
    select: {
      id: true,
      name: true,
      city: true,
      region: true,
      status: true,
      normalizedName: true,
      normalizedPhone: true,
      normalizedEmail: true,
      websiteDomain: true,
      address1: true,
      postalCode: true,
      country: true,
    },
  });

  return candidates
    .map((candidate) => {
      const matchedOn: DuplicateMatchReason[] = [];

      if (candidate.normalizedName === normalizedName) matchedOn.push("name");
      if (websiteDomain && candidate.websiteDomain === websiteDomain) matchedOn.push("websiteDomain");
      if (normalizedPhone && candidate.normalizedPhone === normalizedPhone) matchedOn.push("phone");
      if (normalizedEmail && candidate.normalizedEmail === normalizedEmail) matchedOn.push("email");
      if (
        normalizedAddress &&
        candidate.address1 &&
        normalizeAddressLine(candidate.address1) === normalizedAddress &&
        candidate.postalCode === input.postalCode &&
        candidate.country === input.country
      ) {
        matchedOn.push("address");
      }

      return { id: candidate.id, name: candidate.name, city: candidate.city, region: candidate.region, status: candidate.status, matchedOn };
    })
    .filter((candidate) => candidate.matchedOn.length > 0);
}
