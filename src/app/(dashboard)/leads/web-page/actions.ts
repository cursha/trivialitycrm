"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { WebPageSearchSchema } from "@/lib/validation/search";
import { parseWebsiteUrl } from "@/lib/research/website-email";
import { enqueueSearchJob } from "@/lib/jobs/enqueue";
import { checkAiBudget, getAiSettings } from "@/lib/ai/budget";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { formString } from "@/lib/form-data";
import { writeAuditEvent } from "@/lib/audit/log";

export type WebPageFormState = { error?: string } | undefined;

/**
 * "Read a web page": the businesses listed on one public page, pulled out
 * by AI in the worker (WEB_PAGE mode, see providers/web-page.ts) and shown
 * on the usual results page to review and transfer. Counts against the
 * same AI budget and per-person daily search limit as the other searches.
 */
export async function startWebPageSearch(_prevState: WebPageFormState, formData: FormData): Promise<WebPageFormState> {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const parsed = WebPageSearchSchema.safeParse({
    url: formString(formData, "url"),
    pageText: formString(formData, "pageText"),
    leadTypeId: formString(formData, "leadTypeId"),
    country: formString(formData, "country"),
    region: formString(formData, "region"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };

  const url = parseWebsiteUrl(parsed.data.url);
  if (!url || !url.hostname.includes(".")) {
    return { error: "That isn't a public web address. Paste the full link from your browser's address bar, starting with https://." };
  }

  const budgetCheck = await checkAiBudget();
  if (!budgetCheck.allowed) return { error: budgetCheck.reason };

  const aiSettings = await getAiSettings();
  if (aiSettings.perUserDailySearchLimit !== null) {
    const rateLimit = await checkRateLimit(`ai-search:user:${user.id}`, { windowMs: 24 * 60 * 60 * 1000, limit: aiSettings.perUserDailySearchLimit });
    if (!rateLimit.allowed) return { error: "You've reached today's search limit — please try again tomorrow." };
  }

  const leadType = await prisma.leadType.findUnique({ where: { id: parsed.data.leadTypeId } });
  if (!leadType) return { error: "That Lead Type no longer exists." };

  const search = await prisma.leadSearch.create({
    data: {
      promptId: null,
      createdById: user.id,
      leadTypeId: leadType.id,
      country: parsed.data.country,
      region: parsed.data.region,
      cities: [],
      minimumScore: 0,
      mode: "WEB_PAGE",
      sourceUrl: url.toString(),
      sourceText: parsed.data.pageText?.trim() ? parsed.data.pageText : null,
      promptSnapshot: `Read a web page — list the businesses shown on ${url.toString()} as "${leadType.name}" leads.`,
    },
  });
  const providerJobId = await enqueueSearchJob(search.id);
  await prisma.leadSearch.update({ where: { id: search.id }, data: { providerJobId } });

  await writeAuditEvent({
    actorId: user.id,
    module: "research",
    action: "web_page_search.started",
    entityType: "LeadSearch",
    entityId: search.id,
    metadata: { host: url.hostname, leadType: leadType.name, pasted: Boolean(parsed.data.pageText?.trim()) },
  });

  redirect(`/leads/searches/${search.id}`);
}
