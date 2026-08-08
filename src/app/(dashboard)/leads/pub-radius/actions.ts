"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { companyScope } from "@/lib/companies/scope";
import { MIN_QUERY_LENGTH } from "@/lib/search/global-search";
import { checkAiBudget, getAiSettings } from "@/lib/ai/budget";
import { enqueueSearchJob } from "@/lib/jobs/enqueue";
import { writeAuditEvent } from "@/lib/audit/log";
import { classifyProviderError } from "@/lib/integrations/provider-errors";
import { getGeocoder } from "@/lib/research/providers/geocoder";
import { PubRadiusSetupSchema } from "@/lib/validation/pub-radius";
import { formString } from "@/lib/form-data";

// The Lead Type this app's data actually uses for pubs — confirmed against
// the live Lead Types list ("Mayhem Lead" is the pub category; there is no
// separate "Pub" Lead Type). Resolved by name, same "resolve by name/key"
// convention as COMPETITOR_REJECTION_REASON_NAMES in run-search.ts.
const PUB_LEAD_TYPE_NAME = "Mayhem Lead";

export type PubRadiusOriginOption = { id: string; name: string; city: string; region: string };

/** Origin-pub picker's search-as-you-type — near-identical fork of
 * quickAddCompanySearch (src/app/(dashboard)/quick-add/actions.ts), scoped
 * to ACTIVE companies on the pub Lead Type only. */
export async function searchOriginPubCompanies(query: string): Promise<PubRadiusOriginOption[]> {
  const user = await requireUser();
  if (query.trim().length < MIN_QUERY_LENGTH) return [];

  const rateLimit = await checkRateLimit(`global-search:${user.id}`, { windowMs: 10_000, limit: 30 });
  if (!rateLimit.allowed) return [];

  const scope = companyScope(user);
  if (!scope) return [];

  const contains = { contains: query.trim(), mode: "insensitive" as const };
  const companies = await prisma.company.findMany({
    where: { AND: [scope, { status: "ACTIVE" }, { leadType: { name: PUB_LEAD_TYPE_NAME } }, { name: contains }] },
    select: { id: true, name: true, city: true, region: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return companies;
}

export type PubRadiusFormState = { error?: string } | undefined;

export async function startPubRadiusSearch(_prevState: PubRadiusFormState, formData: FormData): Promise<PubRadiusFormState> {
  const user = await requireUser();
  requirePermission(user, "run_pub_lead_finder");

  const budgetCheck = await checkAiBudget();
  if (!budgetCheck.allowed) {
    return { error: budgetCheck.reason };
  }

  const aiSettings = await getAiSettings();
  if (aiSettings.perUserDailySearchLimit !== null) {
    const rateLimit = await checkRateLimit(`pub-radius:user:${user.id}`, { windowMs: 24 * 60 * 60 * 1000, limit: aiSettings.perUserDailySearchLimit });
    if (!rateLimit.allowed) {
      return { error: "You've reached today's search limit — please try again tomorrow." };
    }
  }

  const parsed = PubRadiusSetupSchema.safeParse({
    originCompanyId: formString(formData, "originCompanyId"),
    radiusValue: formString(formData, "radiusValue"),
    radiusUnit: formString(formData, "radiusUnit") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  // Re-fetch the origin company fresh by id, within the user's own
  // visibility scope — never trust client-supplied address fields, and
  // never let a user center a search on a company they can't otherwise see.
  const scope = companyScope(user);
  const originCompany = scope ? await prisma.company.findFirst({ where: { AND: [scope, { id: parsed.data.originCompanyId }] } }) : null;
  if (!originCompany) {
    return { error: "That pub could not be found." };
  }

  const fullAddress = [originCompany.address1, originCompany.city, originCompany.region, originCompany.postalCode, originCompany.country].filter(Boolean).join(", ");

  let coordinates;
  try {
    coordinates = await getGeocoder().geocode(fullAddress);
  } catch (error) {
    // Same safe-classification path every other provider call in this app
    // goes through (see callProviderSafely() in run-search.ts) — a raw
    // rate-limit/timeout/config error never reaches the form as-is.
    return { error: classifyProviderError(error).safeMessage };
  }
  if (!coordinates) {
    return { error: "Could not find a location for this pub's address — check the address on the Company record and try again." };
  }

  const search = await prisma.leadSearch.create({
    data: {
      createdById: user.id,
      leadTypeId: originCompany.leadTypeId,
      country: originCompany.country,
      region: originCompany.region,
      cities: [originCompany.city],
      minimumScore: aiSettings.defaultMinimumScore,
      mode: "PUB_RADIUS",
      // No PromptTemplate for this mode (promptId stays null) — same as
      // Competition Locator's fixed PROMPT_SNAPSHOT constant. This one's
      // origin-specific, so it's built per-search rather than a shared
      // constant.
      promptSnapshot: `Pub Lead Finder: pub-like venues within ${parsed.data.radiusValue} ${parsed.data.radiusUnit.toLowerCase()} of ${originCompany.name} (${fullAddress}).`,
      originCompanyId: originCompany.id,
      radiusValue: parsed.data.radiusValue,
      radiusUnit: parsed.data.radiusUnit,
      originLat: coordinates.lat,
      originLng: coordinates.lng,
    },
  });
  const providerJobId = await enqueueSearchJob(search.id);
  await prisma.leadSearch.update({ where: { id: search.id }, data: { providerJobId } });

  await writeAuditEvent({
    actorId: user.id,
    module: "research",
    action: "pub_radius.started",
    entityType: "LeadSearch",
    entityId: search.id,
    metadata: { originCompanyId: originCompany.id, originCompanyName: originCompany.name, radiusValue: parsed.data.radiusValue, radiusUnit: parsed.data.radiusUnit },
  });

  redirect(`/leads/searches/${search.id}`);
}
