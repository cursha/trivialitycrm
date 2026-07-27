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
 */
export async function checkAiBudget(): Promise<BudgetCheckResult> {
  const env = getEnv();
  const isAnthropicMode = env.AI_PROVIDER === "anthropic";
  if (!isAnthropicMode) return { allowed: true };

  const settings = await getAiSettings();
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

/**
 * Module Nine: rechecked between candidates in run-search.ts's per-candidate
 * loop — not just once before the search starts. A search that crosses the
 * daily/monthly budget or its own maxCostPerSearchUsd ceiling partway
 * through stops immediately, before placing another paid call, rather than
 * finishing at full cost. Mock mode is always allowed (same rule as
 * checkAiBudget()).
 */
export async function checkMidRunAiBudget(searchId: string): Promise<BudgetCheckResult> {
  const env = getEnv();
  if (env.AI_PROVIDER !== "anthropic") return { allowed: true };

  const settings = await getAiSettings();
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
