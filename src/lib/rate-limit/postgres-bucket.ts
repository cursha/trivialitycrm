// No `import "server-only"` and a relative (not `@/`) import path — this
// module is reachable from the worker too (via
// src/lib/research/providers/http.ts, used by the Anthropic provider's rate
// limiting), not just Next server actions/route handlers. Confirmed by an
// actual worker container crash during this module's build testing:
// server-only throws under plain tsx execution, same class of issue
// src/lib/prisma.ts already documents and works around. See run-search.ts
// for the fuller explanation.
import { prisma } from "../prisma";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the current window resets. */
  retryAfterMs: number;
};

function windowStartFor(windowMs: number, now: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * Fixed-window rate limiter backed by Postgres (RateLimitBucket), shared by
 * every process — web and every worker instance — unlike the in-process
 * token bucket it replaces in src/lib/research/providers/http.ts, which was
 * explicitly documented as "not a distributed limiter" and reset on every
 * restart. At this app's scale (one internal sales team) a single upsert
 * per check is more than fast enough; no in-memory caching layer needed.
 */
export async function checkRateLimit(key: string, options: { windowMs: number; limit: number }): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = windowStartFor(options.windowMs, now);

  const bucket = await prisma.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });

  return {
    allowed: bucket.count <= options.limit,
    remaining: Math.max(0, options.limit - bucket.count),
    retryAfterMs: windowStart.getTime() + options.windowMs - now,
  };
}
