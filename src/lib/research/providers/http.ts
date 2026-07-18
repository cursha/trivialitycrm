import "server-only";

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

/** Minimal in-process token bucket. Fine for the single-process deployment
 * this app runs on (see run-search.ts) — not a distributed limiter. */
class TokenBucket {
  private tokens: number;
  private lastRefillAt = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }

  tryTake(): boolean {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillAt) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefillAt = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const buckets = new Map<string, TokenBucket>();

function bucketFor(providerName: string, capacity: number, refillPerSecond: number): TokenBucket {
  let bucket = buckets.get(providerName);
  if (!bucket) {
    bucket = new TokenBucket(capacity, refillPerSecond);
    buckets.set(providerName, bucket);
  }
  return bucket;
}

export type ProviderCallOptions = {
  providerName: string;
  timeoutMs?: number;
  rateLimit?: { capacity: number; refillPerSecond: number };
};

/** Wraps a provider call with a timeout and a local rate limit. Retries are
 * intentionally left to the caller (a bare retry over a timed-out research
 * call risks doubling an expensive request). */
export async function callProvider<T>(options: ProviderCallOptions, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { providerName, timeoutMs = 30_000, rateLimit = { capacity: 20, refillPerSecond: 1 } } = options;

  const bucket = bucketFor(providerName, rateLimit.capacity, rateLimit.refillPerSecond);
  if (!bucket.tryTake()) {
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
