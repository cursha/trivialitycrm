import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";

// Deliberately no `import "server-only"` — the worker's send-job handler
// needs this too; see token-crypto.ts for the same reasoning.

/** Mirrors src/lib/research/providers/http.ts's ProviderRateLimitError/
 * ProviderTimeoutError/callProvider shape exactly, but under its own
 * "email-send:" rate-limit key namespace (never shares a bucket with the
 * AI-provider "ai-provider:" namespace) — kept as a separate small module
 * rather than generalizing the AI research one, so this module's changes
 * can never affect already-tested research-provider rate limiting. */
export class EmailProviderRateLimitError extends Error {
  constructor(providerName: string) {
    super(`Rate limit exceeded for email provider "${providerName}" — try again shortly.`);
    this.name = "EmailProviderRateLimitError";
  }
}

export class EmailProviderTimeoutError extends Error {
  constructor(providerName: string, timeoutMs: number) {
    super(`Email provider "${providerName}" timed out after ${timeoutMs}ms.`);
    this.name = "EmailProviderTimeoutError";
  }
}

export type EmailProviderCallOptions = {
  providerName: string;
  timeoutMs?: number;
  rateLimit?: { windowMs: number; limit: number };
};

export async function callEmailProvider<T>(options: EmailProviderCallOptions, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { providerName, timeoutMs = 30_000, rateLimit = { windowMs: 60_000, limit: 20 } } = options;

  const result = await checkRateLimit(`email-send:${providerName}`, rateLimit);
  if (!result.allowed) {
    throw new EmailProviderRateLimitError(providerName);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new EmailProviderTimeoutError(providerName, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
