// Hardcoded model/tool pricing for the AiUsageRecord cost estimate that
// feeds the optional AI_DAILY_BUDGET_USD / AI_MONTHLY_BUDGET_USD safeguard.
// Verified directly against https://platform.claude.com/docs/en/about-claude/pricing
// on 2026-07-18 — re-check this page (and update SONNET_5_INTRO_CUTOFF /
// the rates below) before relying on the budget cap after the cutoff date,
// or if the model changes.
const SONNET_5_INTRO_CUTOFF = new Date("2026-09-01T00:00:00Z");

const WEB_SEARCH_COST_PER_REQUEST = 10 / 1000; // $10 per 1,000 searches
const WEB_FETCH_COST_PER_REQUEST = 0; // no additional charge beyond token costs

type TokenRates = {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Simplification: prices the 5-minute cache-write tier (1.25x input) for any
   * cache_creation_input_tokens — this app does not set cache_control today, so
   * these are 0 in practice; revisit if prompt caching is ever enabled. */
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
};

function sonnet5Rates(now: Date): TokenRates {
  const introActive = now.getTime() < SONNET_5_INTRO_CUTOFF.getTime();
  const inputPerMTok = introActive ? 2 : 3;
  const outputPerMTok = introActive ? 10 : 15;
  return {
    inputPerMTok,
    outputPerMTok,
    cacheWritePerMTok: inputPerMTok * 1.25,
    cacheReadPerMTok: inputPerMTok * 0.1,
  };
}

function ratesForModel(model: string, now: Date): TokenRates {
  if (model === "claude-sonnet-5") return sonnet5Rates(now);
  // Unknown model — fail safe to the current Sonnet 5 rates rather than
  // silently under-counting spend against an unrecognized identifier.
  return sonnet5Rates(now);
}

export type UsageInput = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  webSearchRequests?: number;
  webFetchRequests?: number;
};

/** Returns an estimated USD cost for one provider call, plus the raw server-tool-use
 * count (web_search + web_fetch requests) for AiUsageRecord.serverToolUses. */
export function estimateCostUsd(usage: UsageInput, now: Date = new Date()): number {
  const rates = ratesForModel(usage.model, now);

  const tokenCost =
    (usage.inputTokens / 1_000_000) * rates.inputPerMTok +
    (usage.outputTokens / 1_000_000) * rates.outputPerMTok +
    ((usage.cacheCreationTokens ?? 0) / 1_000_000) * rates.cacheWritePerMTok +
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * rates.cacheReadPerMTok;

  const toolCost =
    (usage.webSearchRequests ?? 0) * WEB_SEARCH_COST_PER_REQUEST + (usage.webFetchRequests ?? 0) * WEB_FETCH_COST_PER_REQUEST;

  return tokenCost + toolCost;
}
