"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { SearchSetupSchema } from "@/lib/validation/search";
import { formString } from "@/lib/form-data";
import { enqueueSearchJob, cancelSearchJob } from "@/lib/jobs/enqueue";
import { checkAiBudget, getAiSettings } from "@/lib/ai/budget";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { writeAuditEvent } from "@/lib/audit/log";

export type SearchFormState = { error?: string; budgetBlocked?: boolean } | undefined;

export async function startSearch(_prevState: SearchFormState, formData: FormData): Promise<SearchFormState> {
  const user = await requireUser();
  requirePermission(user, "run_research");

  // "Continue anyway" — a one-time, per-search bypass of the dollar-amount
  // budget checks (never the researchEnabled kill-switch, see budget.ts).
  // Only ever honored for a user with manage_ai_settings, checked here
  // server-side — a client-sent checkbox value is never trusted on its own.
  const requestedOverride = formString(formData, "overrideBudget") === "true";
  const canOverrideBudget = hasPermission(user, "manage_ai_settings");
  const applyOverride = requestedOverride && canOverrideBudget;

  // Module 8A: refuse a new paid AI job once research is disabled or a
  // configured hard budget is already reached — never blocks mock mode.
  const budgetCheck = await checkAiBudget({ overrideSpendLimit: applyOverride });
  if (!budgetCheck.allowed) {
    return { error: budgetCheck.reason, budgetBlocked: true };
  }

  const aiSettings = await getAiSettings();

  if (aiSettings.perUserDailySearchLimit !== null) {
    const rateLimit = await checkRateLimit(`ai-search:user:${user.id}`, { windowMs: 24 * 60 * 60 * 1000, limit: aiSettings.perUserDailySearchLimit });
    if (!rateLimit.allowed) {
      return { error: "You've reached today's search limit — please try again tomorrow." };
    }
  }

  const parsed = SearchSetupSchema.safeParse({
    promptId: formString(formData, "promptId"),
    country: formString(formData, "country"),
    region: formString(formData, "region"),
    cities: formData
      .getAll("cities")
      .map((value) => String(value).trim())
      .filter(Boolean),
    leadTypeId: formString(formData, "leadTypeId"),
    minimumScore: formString(formData, "minimumScore") || String(aiSettings.defaultMinimumScore),
    mode: formString(formData, "mode"),
    competitorId: formString(formData, "competitorId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  if (parsed.data.cities.length > aiSettings.maxCitiesPerSearch) {
    return { error: `An administrator has limited searches to ${aiSettings.maxCitiesPerSearch} cities at a time.` };
  }

  const prompt = await prisma.promptTemplate.findUnique({ where: { id: parsed.data.promptId } });
  if (!prompt) {
    return { error: "That prompt no longer exists." };
  }

  const search = await prisma.leadSearch.create({
    data: {
      promptId: prompt.id,
      createdById: user.id,
      leadTypeId: parsed.data.leadTypeId,
      competitorId: parsed.data.competitorId ?? null,
      country: parsed.data.country,
      region: parsed.data.region,
      cities: parsed.data.cities,
      minimumScore: parsed.data.minimumScore,
      mode: parsed.data.mode,
      promptSnapshot: prompt.qualificationPrompt,
      budgetOverride: applyOverride,
    },
  });

  if (applyOverride) {
    await writeAuditEvent({
      actorId: user.id,
      module: "ai-integration",
      action: "ai_budget.overridden",
      entityType: "LeadSearch",
      entityId: search.id,
      metadata: { reason: budgetCheck.reason ?? null, stage: "start" },
    });
  }

  // Durable execution: enqueue onto the run-search queue and store pg-boss's
  // job id for cancellation lookup. The worker (see worker/handlers/run-search.ts)
  // is the sole consumer — the web process never runs this itself. The
  // status page below polls for progress instead of blocking here.
  const providerJobId = await enqueueSearchJob(search.id);
  await prisma.leadSearch.update({ where: { id: search.id }, data: { providerJobId } });

  redirect(`/leads/searches/${search.id}`);
}

export async function cancelSearch(searchId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const search = await prisma.leadSearch.findUnique({ where: { id: searchId } });
  if (!search) {
    return { error: "That search no longer exists." };
  }
  if (search.status === "SUCCEEDED" || search.status === "FAILED" || search.status === "CANCELLED") {
    return { error: "This search has already finished and can't be cancelled." };
  }

  // Prevents a not-yet-claimed job from ever running; a job already active
  // is stopped cooperatively by run-search.ts polling this status between
  // candidates (see RunSearchJobOptions.isCancelled).
  if (search.providerJobId) {
    await cancelSearchJob(search.providerJobId);
  }

  await prisma.leadSearch.update({
    where: { id: searchId },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return {};
}

/**
 * Resumes a search that stopped on a budget-blocked FAILED status (see
 * isBudgetBlockedReason() in budget.ts) — sets the one-time override flag
 * and re-enqueues. runSearchJob is fully resumable from its existing
 * SearchCandidate checkpoints (see its own doc comment), so this picks up
 * exactly where the search left off rather than starting over. Restricted
 * to manage_ai_settings, same as the start-time override — resuming past a
 * spend limit is the same authorization decision either way.
 */
export async function retrySearchWithBudgetOverride(searchId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  requirePermission(user, "run_research");
  requirePermission(user, "manage_ai_settings");

  const search = await prisma.leadSearch.findUnique({ where: { id: searchId } });
  if (!search) {
    return { error: "That search no longer exists." };
  }
  if (search.status !== "FAILED") {
    return { error: "Only a failed search can be resumed this way." };
  }

  await prisma.leadSearch.update({ where: { id: searchId }, data: { budgetOverride: true } });

  await writeAuditEvent({
    actorId: user.id,
    module: "ai-integration",
    action: "ai_budget.overridden",
    entityType: "LeadSearch",
    entityId: searchId,
    metadata: { reason: search.errorMessage, stage: "resume" },
  });

  const providerJobId = await enqueueSearchJob(searchId);
  await prisma.leadSearch.update({ where: { id: searchId }, data: { providerJobId } });

  return {};
}
