// DB-backed AI configuration and budget enforcement — the runtime source of
// truth going forward, replacing the previously-inert AI_DAILY_BUDGET_USD/
// AI_MONTHLY_BUDGET_USD env vars (declared and validated in src/lib/env.ts
// but never read anywhere before this module). Called from
// src/app/(dashboard)/leads/searches/actions.ts's startSearch() before a
// new LeadSearch/job is created — never mid-job, matching the plan's
// "refuse NEW paid AI jobs" wording literally.
//
// No `import "server-only"` — src/lib/research/providers/anthropic.ts
// (which runs in the worker under plain tsx) needs getAiSettings() to read
// the approved model, and that guard throws under plain Node/tsx
// execution. Same reasoning as src/lib/prisma.ts's identical omission.
import { prisma } from "../prisma";
import { getEnv } from "../env";
import { zonedDayRange, zonedMonthRange } from "../timezone";
import { APPROVED_MODEL_OPTIONS } from "./models";

// Re-exported for existing importers — the values themselves live in
// models.ts (see that file's header comment for why the split exists).
export { APPROVED_MODEL_OPTIONS };
export type { ApprovedModel } from "./models";

export type AiSettingsValues = {
  researchEnabled: boolean;
  approvedModel: string;
  defaultMinimumScore: number;
  maxCitiesPerSearch: number;
  maxResultsPerSearch: number | null;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  warningThresholdUsd: number | null;
  perUserDailySearchLimit: number | null;
  // Module Nine: hard $ ceiling for one search, rechecked mid-run — see
  // checkMidRunAiBudget() below.
  maxCostPerSearchUsd: number | null;
  // Module Ten: web_search/web_fetch max_uses per Anthropic discovery/
  // verification call — see src/lib/research/providers/anthropic.ts.
  maxSearchToolUsesPerCall: number;
  // Split from maxSearchToolUsesPerCall — opportunity analysis's own
  // search/fetch budget, defaulted lower (see schema.prisma's comment for
  // why: a thin-evidence business should fail fast and cheap, not grind).
  maxSearchToolUsesPerOpportunityAnalysis: number;
};

/**
 * Reads the singleton AiSettings row, creating it (seeded from the legacy
 * env vars if set, same one-time-seed idea documented in the schema)
 * defensively if somehow missing — mirrors WorkspaceSettings' own
 * find-or-fallback pattern rather than assuming the seed script always ran
 * first.
 */
export async function getAiSettings(): Promise<AiSettingsValues> {
  const existing = await prisma.aiSettings.findUnique({ where: { id: 1 } });
  if (existing) {
    return {
      researchEnabled: existing.researchEnabled,
      approvedModel: existing.approvedModel,
      defaultMinimumScore: existing.defaultMinimumScore,
      maxCitiesPerSearch: existing.maxCitiesPerSearch,
      maxResultsPerSearch: existing.maxResultsPerSearch,
      dailyBudgetUsd: existing.dailyBudgetUsd ? Number(existing.dailyBudgetUsd) : null,
      monthlyBudgetUsd: existing.monthlyBudgetUsd ? Number(existing.monthlyBudgetUsd) : null,
      warningThresholdUsd: existing.warningThresholdUsd ? Number(existing.warningThresholdUsd) : null,
      perUserDailySearchLimit: existing.perUserDailySearchLimit,
      maxCostPerSearchUsd: existing.maxCostPerSearchUsd ? Number(existing.maxCostPerSearchUsd) : null,
      maxSearchToolUsesPerCall: existing.maxSearchToolUsesPerCall,
      maxSearchToolUsesPerOpportunityAnalysis: existing.maxSearchToolUsesPerOpportunityAnalysis,
    };
  }

  const env = getEnv();
  const created = await prisma.aiSettings.create({
    data: {
      id: 1,
      dailyBudgetUsd: env.AI_DAILY_BUDGET_USD ?? null,
      monthlyBudgetUsd: env.AI_MONTHLY_BUDGET_USD ?? null,
    },
  });
  return {
    researchEnabled: created.researchEnabled,
    approvedModel: created.approvedModel,
    defaultMinimumScore: created.defaultMinimumScore,
    maxCitiesPerSearch: created.maxCitiesPerSearch,
    maxResultsPerSearch: created.maxResultsPerSearch,
    dailyBudgetUsd: created.dailyBudgetUsd ? Number(created.dailyBudgetUsd) : null,
    monthlyBudgetUsd: created.monthlyBudgetUsd ? Number(created.monthlyBudgetUsd) : null,
    warningThresholdUsd: created.warningThresholdUsd ? Number(created.warningThresholdUsd) : null,
    perUserDailySearchLimit: created.perUserDailySearchLimit,
    maxCostPerSearchUsd: created.maxCostPerSearchUsd ? Number(created.maxCostPerSearchUsd) : null,
    maxSearchToolUsesPerCall: created.maxSearchToolUsesPerCall,
    maxSearchToolUsesPerOpportunityAnalysis: created.maxSearchToolUsesPerOpportunityAnalysis,
  };
}

export type AiSpend = { todayUsd: number; monthUsd: number };

/** Sums AiUsageRecord.estimatedCostUsd for the current business day and
 * business month — same zonedDayRange/zonedMonthRange boundaries every
 * other "today"/"this month" figure in this app already uses. */
export async function getCurrentAiSpend(reference: Date = new Date()): Promise<AiSpend> {
  const day = zonedDayRange(reference);
  const month = zonedMonthRange(reference);

  const [todaySum, monthSum] = await Promise.all([
    prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: day.start, lt: day.end } }, _sum: { estimatedCostUsd: true } }),
    prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: month.start, lt: month.end } }, _sum: { estimatedCostUsd: true } }),
  ]);

  return {
    todayUsd: Number(todaySum._sum.estimatedCostUsd ?? 0),
    monthUsd: Number(monthSum._sum.estimatedCostUsd ?? 0),
  };
}

export type AiBudgetStatus = "ok" | "near-threshold" | "over-budget" | "not-configured";

/**
 * Same over/near-threshold classification the Administration summary has
 * always computed inline — pulled out here so the Dashboard's AI usage card
 * (an admin-visible, at-a-glance version of the same figures, so budget
 * overruns aren't only discovered when someone happens to visit
 * Administration) can share the exact same logic rather than a second,
 * driftable copy.
 */
export function classifyAiBudgetStatus(settings: AiSettingsValues, spend: AiSpend): AiBudgetStatus {
  if (settings.dailyBudgetUsd === null && settings.monthlyBudgetUsd === null) return "not-configured";

  const overDaily = settings.dailyBudgetUsd !== null && spend.todayUsd >= settings.dailyBudgetUsd;
  const overMonthly = settings.monthlyBudgetUsd !== null && spend.monthUsd >= settings.monthlyBudgetUsd;
  if (overDaily || overMonthly) return "over-budget";

  const nearDaily = settings.warningThresholdUsd !== null && spend.todayUsd >= settings.warningThresholdUsd;
  const nearMonthly = settings.warningThresholdUsd !== null && spend.monthUsd >= settings.warningThresholdUsd;
  if (nearDaily || nearMonthly) return "near-threshold";

  return "ok";
}

export type BudgetCheckResult = { allowed: boolean; reason?: string };

/**
 * Pure decision core, unit-tested directly against synthetic spend/settings
 * without touching the database — checkAiBudget() below is the thin,
 * DB-wired caller. `isAnthropicMode` is passed in rather than read from
 * getEnv() here so this function has no I/O at all: mock mode is never
 * blocked (it costs nothing and never calls a real provider — blocking it
 * would be meaningless and could make mock-mode testing mysteriously stop
 * working).
 */
export function evaluateAiBudget(params: { isAnthropicMode: boolean; researchEnabled: boolean; spend: AiSpend; dailyBudgetUsd: number | null; monthlyBudgetUsd: number | null }): BudgetCheckResult {
  if (!params.isAnthropicMode) return { allowed: true };

  if (!params.researchEnabled) {
    return { allowed: false, reason: "AI research is currently disabled by an administrator." };
  }
  if (params.dailyBudgetUsd !== null && params.spend.todayUsd >= params.dailyBudgetUsd) {
    return { allowed: false, reason: "Today's AI research budget has been reached." };
  }
  if (params.monthlyBudgetUsd !== null && params.spend.monthUsd >= params.monthlyBudgetUsd) {
    return { allowed: false, reason: "This month's AI research budget has been reached." };
  }
  return { allowed: true };
}

/**
 * Refuses a new paid AI job once a configured hard budget is already met or
 * exceeded — the DB-wired caller of evaluateAiBudget() above.
 *
 * `overrideSpendLimit` is the one-time, per-search "Continue anyway" bypass
 * (LeadSearch.budgetOverride) — it only ever skips the dollar-amount checks
 * below. `researchEnabled` is checked first and unconditionally, regardless
 * of the override: that's an administrator's explicit kill-switch, not a
 * spend limit, and no per-search flag should be able to talk its way past
 * "research is turned off."
 */
export async function checkAiBudget(options?: { overrideSpendLimit?: boolean }): Promise<BudgetCheckResult> {
  const env = getEnv();
  const isAnthropicMode = env.AI_PROVIDER === "anthropic";
  if (!isAnthropicMode) return { allowed: true };

  const settings = await getAiSettings();
  if (!settings.researchEnabled) {
    return { allowed: false, reason: "AI research is currently disabled by an administrator." };
  }
  if (options?.overrideSpendLimit) return { allowed: true };

  const spend = await getCurrentAiSpend();
  return evaluateAiBudget({
    isAnthropicMode,
    researchEnabled: settings.researchEnabled,
    spend,
    dailyBudgetUsd: settings.dailyBudgetUsd,
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
  });
}

/** Never returns the raw key — only whether one is configured. The AI
 * Settings and System Health pages must call only this, never
 * getEnv().AI_API_KEY directly. */
export function isAiApiKeyConfigured(): boolean {
  return Boolean(getEnv().AI_API_KEY);
}

// The three reason strings evaluateAiBudget()/checkMidRunAiBudget() ever
// return for a spend-limit block (never for researchEnabled — see both
// functions' own comments on why that one is deliberately never
// override-able). Matched by substring, not exact equality, so a reason
// string in either function can still gain more detail later (e.g.
// interpolating the actual dollar amount) without silently breaking this
// check.
const BUDGET_BLOCKED_MARKERS = ["budget has been reached", "maximum per-search AI budget", "AI budget limit reached mid-run"];

/** Whether a LeadSearch.errorMessage represents a spend-limit block that a
 * "Continue anyway" override (LeadSearch.budgetOverride) can actually fix —
 * as opposed to a real provider failure, or the researchEnabled kill-switch,
 * which no per-search override can bypass. Used by the resume UI to decide
 * whether offering that button would do anything. */
export function isBudgetBlockedReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return BUDGET_BLOCKED_MARKERS.some((marker) => reason.includes(marker));
}

/**
 * Module Nine: rechecked between candidates in run-search.ts's per-candidate
 * loop — not just once before the search starts. A search that crosses the
 * daily/monthly budget or its own maxCostPerSearchUsd ceiling partway
 * through stops immediately, before placing another paid call, rather than
 * finishing at full cost. Mock mode is always allowed (same rule as
 * checkAiBudget()).
 *
 * `overrideSpendLimit` — same one-time bypass as checkAiBudget() above,
 * threaded through from LeadSearch.budgetOverride by the caller
 * (run-search.ts). Skips the daily/monthly AND per-search cost ceiling
 * checks, never the researchEnabled kill-switch.
 */
export async function checkMidRunAiBudget(searchId: string, options?: { overrideSpendLimit?: boolean }): Promise<BudgetCheckResult> {
  const env = getEnv();
  if (env.AI_PROVIDER !== "anthropic") return { allowed: true };

  const settings = await getAiSettings();
  if (!settings.researchEnabled) {
    return { allowed: false, reason: "AI research is currently disabled by an administrator." };
  }
  if (options?.overrideSpendLimit) return { allowed: true };

  const spend = await getCurrentAiSpend();
  const overall = evaluateAiBudget({
    isAnthropicMode: true,
    researchEnabled: settings.researchEnabled,
    spend,
    dailyBudgetUsd: settings.dailyBudgetUsd,
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
  });
  if (!overall.allowed) return overall;

  if (settings.maxCostPerSearchUsd !== null) {
    const searchSpend = await prisma.aiUsageRecord.aggregate({
      where: { searchId },
      _sum: { estimatedCostUsd: true },
    });
    const spentOnThisSearch = Number(searchSpend._sum.estimatedCostUsd ?? 0);
    if (spentOnThisSearch >= settings.maxCostPerSearchUsd) {
      return { allowed: false, reason: "This search has reached its maximum per-search AI budget." };
    }
  }

  return { allowed: true };
}
