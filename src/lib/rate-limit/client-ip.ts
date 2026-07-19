import "server-only";
import { headers } from "next/headers";

/**
 * Trusted-proxy client-IP resolution for Railway. Verified against Railway's
 * documented edge-proxy behavior (see MODULE_3_REPORT.md for sources): the
 * edge strips and rebuilds X-Forwarded-For itself — a client cannot inject
 * or overwrite it — and exposes X-Real-IP as a single-source-of-truth
 * header for the connecting client. If a Cloudflare-fronted custom domain
 * is ever added in front of Railway, Railway rewrites Cf-Connecting-IP to
 * the real client IP sourced only from trusted Cloudflare infrastructure,
 * so that takes precedence when present. This is deliberately NOT a blind
 * `headers().get("x-forwarded-for")` read — an untrusted proxy setup could
 * let a client forge that header outright.
 *
 * Pure and synchronous so the precedence logic itself is directly
 * unit-testable with synthetic Headers, independent of Next.js/next/headers.
 */
export function resolveClientIp(headers: Headers): string | null {
  const cloudflare = headers.get("cf-connecting-ip");
  if (cloudflare?.trim()) return cloudflare.trim();

  const railwayRealIp = headers.get("x-real-ip");
  if (railwayRealIp?.trim()) return railwayRealIp.trim();

  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const leftmost = forwardedFor.split(",")[0]?.trim();
    if (leftmost) return leftmost;
  }

  // No trusted header present (e.g. local dev with no proxy in front at
  // all) — the caller must treat this as "IP unknown" and skip the
  // IP-based check rather than fail open on an unverifiable value. The
  // existing per-account DB-backed lockout (src/lib/auth/rate-limit.ts)
  // still applies regardless.
  return null;
}

/** Next.js-integrated wrapper — reads the current request's headers via next/headers. */
export async function getClientIp(): Promise<string | null> {
  const requestHeaders = await headers();
  return resolveClientIp(requestHeaders);
}
