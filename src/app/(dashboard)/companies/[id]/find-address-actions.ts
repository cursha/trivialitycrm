"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { normalizePostalCode } from "@/lib/data-quality/normalize";
import { writeAuditEvent } from "@/lib/audit/log";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { getAddressLookup, type FoundAddress } from "@/lib/research/providers/address-lookup";

export type FindCompanyAddressResult = { error: string } | { address: string } | { address: null; note: string };

/**
 * Quick Sales Actions "Find address": looks the bar up on Google Places by
 * name and city and saves its street address (and postal code, if that's
 * blank too). Not an AI call. Only fills an empty street address, so one
 * typed in meanwhile is never overwritten.
 */
export async function findCompanyAddress(companyId: string): Promise<FindCompanyAddressResult> {
  const user = await requireUser();
  requirePermission(user, "edit_leads");
  const scope = companyScope(user);
  const company = scope ? await prisma.company.findFirst({ where: { id: companyId, ...scope } }) : null;
  if (!company) return { error: "You do not have access to this company." };
  if (company.address1?.trim()) return { error: "This company already has a street address." };
  if (!company.city.trim()) return { error: "Add the city first so the right bar can be found." };

  const rateLimit = await checkRateLimit(`find-address:${user.id}`, { windowMs: 60_000, limit: 10 });
  if (!rateLimit.allowed) return { error: "Too many address lookups — wait a minute and try again." };

  let found: FoundAddress | null;
  try {
    found = await getAddressLookup().findAddress({ name: company.name, city: company.city, region: company.region, country: company.country });
  } catch {
    return { error: "The address lookup didn't work this time — try again later." };
  }
  if (!found) return { address: null, note: `No address found for ${company.name} in ${company.city}` };

  const fillPostal = !company.postalCode?.trim() && !!found.postalCode;
  const { count } = await prisma.company.updateMany({
    where: { id: company.id, OR: [{ address1: null }, { address1: "" }] },
    data: {
      address1: found.address1,
      ...(fillPostal ? { postalCode: found.postalCode, normalizedPostalCode: normalizePostalCode(found.postalCode!, company.country) } : {}),
      updatedById: user.id,
    },
  });
  if (count === 0) return { error: "Someone added an address meanwhile — refresh the page." };

  await writeAuditEvent({
    actorId: user.id,
    module: "companies",
    action: "company.address_found",
    entityType: "Company",
    entityId: company.id,
    afterData: { address1: found.address1, ...(fillPostal ? { postalCode: found.postalCode } : {}) },
    metadata: { how: "google_places" },
  });
  revalidatePath(`/companies/${company.id}`);
  return { address: found.formattedAddress };
}
