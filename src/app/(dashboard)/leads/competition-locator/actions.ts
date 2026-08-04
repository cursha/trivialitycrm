"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { CompetitionLocatorStartSchema } from "@/lib/validation/competition-locator";
import { ALL_NORTH_AMERICAN_REGIONS } from "@/lib/constants/north-american-regions";
import { formString } from "@/lib/form-data";
import { enqueueSearchJob } from "@/lib/jobs/enqueue";
import { checkAiBudget, getAiSettings } from "@/lib/ai/budget";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { writeAuditEvent, newCorrelationId } from "@/lib/audit/log";

export type CompetitionLocatorFormState = { error?: string; budgetBlocked?: boolean } | undefined;

// Fixed, non-user-editable criteria snapshot — Competition Locator has no
// PromptTemplate of its own (LeadSearch.promptId stays null); the venue-type
// criteria live here plus in modeInstructions()'s "COMPETITOR" case
// (src/lib/research/providers/anthropic.ts), which supplies the actual
// competitor name and verification standard at call time.
const PROMPT_SNAPSHOT =
  "Find pubs, bars, breweries, taprooms, restaurants, or similar licensed venues. " +
  "Only report a venue as a match when there is direct, current evidence tying it to the specific competitor being searched for.";

export async function startCompetitionLocatorRun(_prevState: CompetitionLocatorFormState, formData: FormData): Promise<CompetitionLocatorFormState> {
  const user = await requireUser();
  requirePermission(user, "run_competition_locator");

  // "Continue anyway" — same one-time, per-run bypass as the regular Lead
  // Search form (see leads/searches/actions.ts#startSearch). Only ever
  // honored for manage_ai_settings, checked here server-side.
  const requestedOverride = formString(formData, "overrideBudget") === "true";
  const canOverrideBudget = hasPermission(user, "manage_ai_settings");
  const applyOverride = requestedOverride && canOverrideBudget;

  const budgetCheck = await checkAiBudget({ overrideSpendLimit: applyOverride });
  if (!budgetCheck.allowed) {
    return { error: budgetCheck.reason, budgetBlocked: true };
  }

  const aiSettings = await getAiSettings();

  // Treated as ONE unit against the daily search limit, however many
  // regions it expands to below — calling the per-search limit once per
  // region would let a single blank-region ("search everywhere") click
  // silently exhaust a user's entire daily allowance in one submission,
  // defeating the limit's intent. A deliberate policy choice, not an
  // oversight — see the Competition Locator plan's regression notes.
  if (aiSettings.perUserDailySearchLimit !== null) {
    const rateLimit = await checkRateLimit(`competition-locator:user:${user.id}`, { windowMs: 24 * 60 * 60 * 1000, limit: aiSettings.perUserDailySearchLimit });
    if (!rateLimit.allowed) {
      return { error: "You've reached today's search limit — please try again tomorrow." };
    }
  }

  const regionValues = formData.getAll("regions").map((value) => String(value));
  const parsed = CompetitionLocatorStartSchema.safeParse({
    competitorId: formString(formData, "competitorId"),
    leadTypeId: formString(formData, "leadTypeId"),
    regions: regionValues
      .map((value) => {
        const [country, code] = value.split("|");
        return country && code ? { country, code } : null;
      })
      .filter((value): value is { country: string; code: string } => value !== null),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const competitor = await prisma.competitor.findUnique({ where: { id: parsed.data.competitorId } });
  if (!competitor) {
    return { error: "That competitor no longer exists." };
  }

  // Blank selection = search broadly across every state/province in both
  // countries (see north-american-regions.ts — excludes Canadian
  // territories per the "no territories" scope).
  const regions = parsed.data.regions.length > 0 ? parsed.data.regions : ALL_NORTH_AMERICAN_REGIONS.map((r) => ({ country: r.country, code: r.code }));

  const runCorrelationId = newCorrelationId();

  for (const region of regions) {
    // budgetOverride set on every child search up front — not just the
    // first one to hit the wall — since the daily/monthly budget is global,
    // not per-search: without this, a multi-region run would just re-block
    // on the very next region and force clicking "continue" over and over.
    const search = await prisma.leadSearch.create({
      data: {
        createdById: user.id,
        leadTypeId: parsed.data.leadTypeId,
        competitorId: competitor.id,
        country: region.country,
        region: region.code,
        cities: [],
        minimumScore: aiSettings.defaultMinimumScore,
        mode: "COMPETITOR",
        promptSnapshot: PROMPT_SNAPSHOT,
        runCorrelationId,
        budgetOverride: applyOverride,
      },
    });
    const providerJobId = await enqueueSearchJob(search.id);
    await prisma.leadSearch.update({ where: { id: search.id }, data: { providerJobId } });
  }

  await writeAuditEvent({
    actorId: user.id,
    module: "research",
    action: "competition_locator.started",
    entityType: "LeadSearch",
    correlationId: runCorrelationId,
    metadata: { competitorId: competitor.id, competitorName: competitor.name, regionCount: regions.length },
  });

  if (applyOverride) {
    await writeAuditEvent({
      actorId: user.id,
      module: "ai-integration",
      action: "ai_budget.overridden",
      entityType: "LeadSearch",
      correlationId: runCorrelationId,
      metadata: { reason: budgetCheck.reason ?? null, stage: "start", regionCount: regions.length },
    });
  }

  redirect(`/leads/competition-locator/${runCorrelationId}`);
}
