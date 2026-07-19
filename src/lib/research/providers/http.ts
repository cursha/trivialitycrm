import { checkRateLimit } from "../../rate-limit/postgres-bucket";

/** Thrown when a provider call is rejected by the local rate limiter (distinct from the
 * provider's own 429s, which the caller should retry with backoff instead). */
export class ProviderRateLimitError extends Error {
  constructor(providerName: string) {
    super(`Rate limit exceeded for provider "${providerName}" — try again shortly.`);
    this.name = "ProviderRateLimitError";
  }
}

export class ProviderTimeoutError extends Error {
  constructor(providerName: string, timeoutMs: number) {
    super(`Provider "${providerName}" timed out after ${timeoutMs}ms.`);
    this.name = "ProviderTimeoutError";
  }
}

export type ProviderCallOptions = {
  providerName: string;
  timeoutMs?: number;
  /** Fixed-window limit, e.g. { windowMs: 60_000, limit: 30 } = 30 calls/minute. */
  rateLimit?: { windowMs: number; limit: number };
};

/**
 * Wraps a provider call with a timeout and a rate limit. The rate limit is
 * Postgres-backed (see src/lib/rate-limit/postgres-bucket.ts) — shared
 * across every process (the worker is normally the only caller, but this is
 * correct even if it's ever scaled to multiple instances) and durable
 * across restarts, replacing an earlier in-process token bucket that reset
 * on every deploy and wasn't shared across instances.
 *
 * Retries are intentionally left to the caller (a bare retry over a
 * timed-out research call risks doubling an expensive request) — see
 * anthropic.ts's client(), which sets the Anthropic SDK's own maxRetries
 * explicitly instead of hand-rolling retry logic here.
 */
export async function callProvider<T>(options: ProviderCallOptions, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { providerName, timeoutMs = 30_000, rateLimit = { windowMs: 60_000, limit: 30 } } = options;

  const result = await checkRateLimit(`ai-provider:${providerName}`, rateLimit);
  if (!result.allowed) {
    throw new ProviderRateLimitError(providerName);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProviderTimeoutError(providerName, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
