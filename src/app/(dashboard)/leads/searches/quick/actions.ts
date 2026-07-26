"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { QuickSearchSetupSchema } from "@/lib/validation/search";
import { formString } from "@/lib/form-data";
import { enqueueSearchJob } from "@/lib/jobs/enqueue";
import { checkAiBudget, getAiSettings } from "@/lib/ai/budget";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";

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

  const searchIds: string[] = [];
  for (const leadType of leadTypes) {
    const search = await prisma.leadSearch.create({
      data: {
        promptId: null,
        createdById: user.id,
        leadTypeId: leadType.id,
        country: parsed.data.country,
        region: parsed.data.region,
        cities: parsed.data.cities,
        minimumScore: 0,
        mode: "GENERAL",
        promptSnapshot: `Quick search — list every "${leadType.name}" match in ${parsed.data.region}, ${parsed.data.country}. No AI qualification prompt used.`,
      },
    });
    const providerJobId = await enqueueSearchJob(search.id);
    await prisma.leadSearch.update({ where: { id: search.id }, data: { providerJobId } });
    searchIds.push(search.id);
  }

  if (searchIds.length === 1) {
    redirect(`/leads/searches/${searchIds[0]}`);
  }
  redirect(`/leads/searches/quick/batch?ids=${searchIds.join(",")}`);
}
