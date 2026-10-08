"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { QuickSearchSetupSchema, CityListSchema } from "@/lib/validation/search";
import { writeAuditEvent } from "@/lib/audit/log";
import { formString } from "@/lib/form-data";
import { enqueueSearchJob } from "@/lib/jobs/enqueue";
import { checkAiBudget, getAiSettings } from "@/lib/ai/budget";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { describeEntertainment, describeVenueKinds } from "@/lib/research/entertainment";

export type QuickSearchFormState = { error?: string } | undefined;

/**
 * Quick Search: check off one or more Lead Types and an area, get a plain
 * directory listing back — no prompt to write, no AI qualification. Always
 * GENERAL mode, which already skips verify()/score() entirely (see
 * run-search.ts). A LeadSearch (and the Company a result later transfers
 * into) is always tied to exactly one Lead Type, so each checked type
 * becomes its own LeadSearch here rather than one search spanning several.
 */
export async function startQuickSearch(_prevState: QuickSearchFormState, formData: FormData): Promise<QuickSearchFormState> {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const budgetCheck = await checkAiBudget();
  if (!budgetCheck.allowed) {
    return { error: budgetCheck.reason };
  }

  const aiSettings = await getAiSettings();

  if (aiSettings.perUserDailySearchLimit !== null) {
    const rateLimit = await checkRateLimit(`ai-search:user:${user.id}`, { windowMs: 24 * 60 * 60 * 1000, limit: aiSettings.perUserDailySearchLimit });
    if (!rateLimit.allowed) {
      return { error: "You've reached today's search limit — please try again tomorrow." };
    }
  }

  const parsed = QuickSearchSetupSchema.safeParse({
    leadTypeIds: formData.getAll("leadTypeIds").map((value) => String(value)),
    country: formString(formData, "country"),
    region: formString(formData, "region"),
    cities: formData
      .getAll("cities")
      .map((value) => String(value).trim())
      .filter(Boolean),
    entertainment: formData.getAll("entertainment").map((value) => String(value)),
    venueKinds: formData.getAll("venueKinds").map((value) => String(value)),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  if (parsed.data.cities.length > aiSettings.maxCitiesPerSearch) {
    return { error: `An administrator has limited searches to ${aiSettings.maxCitiesPerSearch} cities at a time.` };
  }

  const leadTypes = await prisma.leadType.findMany({ where: { id: { in: parsed.data.leadTypeIds } } });
  if (leadTypes.length !== parsed.data.leadTypeIds.length) {
    return { error: "One or more selected Lead Types no longer exist." };
  }

  const { entertainment, venueKinds } = parsed.data;
  const offering = entertainment.length === 0 ? "" : ` offering ${describeEntertainment(entertainment)}`;
  const searchingFor = venueKinds.length === 0 ? "" : ` (searching for ${describeVenueKinds(venueKinds)})`;

  // "Run each city as its own search": a pasted list of cities becomes one
  // search per city, each with its own results page, instead of one search
  // whose results mix every city.
  const perCity = formData.get("perCity") === "on" && parsed.data.cities.length > 1;
  const cityGroups = perCity ? parsed.data.cities.map((city) => [city]) : [parsed.data.cities];

  const searchIds: string[] = [];
  for (const leadType of leadTypes) {
    for (const cities of cityGroups) {
      const where = cities.length === 1 ? `${cities[0]}, ${parsed.data.region}` : parsed.data.region;
      const search = await prisma.leadSearch.create({
        data: {
          promptId: null,
          createdById: user.id,
          leadTypeId: leadType.id,
          country: parsed.data.country,
          region: parsed.data.region,
          cities,
          minimumScore: 0,
          mode: "GENERAL",
          entertainment,
          venueKinds,
          promptSnapshot: `Quick search — list every "${leadType.name}"${searchingFor}${offering} match in ${where}, ${parsed.data.country}. No AI qualification prompt used.`,
        },
      });
      const providerJobId = await enqueueSearchJob(search.id);
      await prisma.leadSearch.update({ where: { id: search.id }, data: { providerJobId } });
      searchIds.push(search.id);
    }
  }

  if (searchIds.length === 1) {
    redirect(`/leads/searches/${searchIds[0]}`);
  }
  redirect(`/leads/searches/quick/batch?ids=${searchIds.join(",")}`);
}

export type CityListActionResult = { error: string } | { id: string; replaced: boolean };

/**
 * Saves the cities, country and province on the Quick Search form as a
 * named list anyone who can run Quick Search can pick later. Saving under a
 * name that's already used replaces that list (the form says so first).
 */
export async function saveCityList(input: { name: string; country: string; region: string; cities: string[] }): Promise<CityListActionResult> {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const parsed = CityListSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the list." };
  const { name, country, region, cities } = parsed.data;

  const existing = await prisma.cityList.findUnique({ where: { name } });
  const list = await prisma.cityList.upsert({
    where: { name },
    create: { name, country, region, cities, createdById: user.id },
    update: { country, region, cities },
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "research",
    action: existing ? "city_list.replaced" : "city_list.created",
    entityType: "CityList",
    entityId: list.id,
    metadata: { name, region, country, cityCount: cities.length },
  });
  revalidatePath("/leads/searches/quick");
  return { id: list.id, replaced: existing !== null };
}

export async function deleteCityList(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const list = await prisma.cityList.findUnique({ where: { id } });
  if (!list) return { error: "That list no longer exists." };
  await prisma.cityList.delete({ where: { id } });

  await writeAuditEvent({
    actorId: user.id,
    module: "research",
    action: "city_list.deleted",
    entityType: "CityList",
    entityId: id,
    metadata: { name: list.name, cityCount: list.cities.length },
  });
  revalidatePath("/leads/searches/quick");
  return {};
}

