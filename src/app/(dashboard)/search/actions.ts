"use server";

import { requireUser } from "@/lib/auth/current-user";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { globalSearch, MIN_QUERY_LENGTH, type GlobalSearchResults } from "@/lib/search/global-search";

export type GlobalSearchOutcome = { ok: true; results: GlobalSearchResults } | { ok: false; error: string };

const EMPTY: GlobalSearchResults = { companies: [], contacts: [], competitors: [] };

/**
 * Rate-limited to a fairly generous window since this fires on every
 * debounced keystroke (300ms debounce client-side) — a genuinely fast
 * typist doing a longer query could hit it 10+ times in a few seconds
 * without this being abuse.
 */
export async function globalSearchAction(query: string): Promise<GlobalSearchOutcome> {
  const user = await requireUser();

  if (query.trim().length < MIN_QUERY_LENGTH) {
    return { ok: true, results: EMPTY };
  }

  const rateLimit = await checkRateLimit(`global-search:${user.id}`, { windowMs: 10_000, limit: 30 });
  if (!rateLimit.allowed) {
    return { ok: false, error: "Searching too quickly — pause a moment." };
  }

  const results = await globalSearch(user, query);
  return { ok: true, results };
}
