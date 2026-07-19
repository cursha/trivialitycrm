// Pulled out of next.config.ts so the header *values* are unit-testable —
// next.config.ts's headers() function isn't itself exercised by a
// route-handler-level test (it's applied by the Next server, not by calling
// a handler function directly); a real next build && next start HTTP smoke
// test covers that application step, this covers the values.

// 'unsafe-inline' on script-src is required (not a placeholder to tighten
// later without also switching to a nonce-based CSP) — confirmed by
// actually building and running this app's production container during
// this module's build testing. Next.js's own streaming RSC bootstrap
// (`self.__next_f.push(...)`) ships as inline <script> tags with no `src`;
// the built /login page alone has 6 of them. A bare `script-src 'self'`
// would block the app's own hydration in a real browser, not just some
// hypothetical third-party script. This matches Next's own documented
// "Without Nonces" reference CSP (node_modules/next/dist/docs/01-app/
// 02-guides/content-security-policy.md), which includes 'unsafe-inline' on
// script-src too, not only style-src — a nonce-based CSP (see that same doc)
// would avoid this trade-off but requires forcing every page (including the
// currently-static /login) into dynamic rendering to generate a fresh nonce
// per request; not undertaken here, noted as a stronger option for later.
export function buildCsp(isProduction: boolean): string {
  return `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type SecurityHeader = { key: string; value: string };

/** X-Frame-Options is intentionally omitted — superseded by the CSP's
 * frame-ancestors directive above (modern browser support makes the older
 * header redundant; see Next's own headers.md doc). Strict-Transport-Security
 * is production-only — sending it over plain HTTP in local dev would pin a
 * browser to HTTPS-only for localhost, which is exactly the kind of
 * confusing local-dev breakage a security header shouldn't cause. */
export function buildSecurityHeaders(isProduction: boolean): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "Content-Security-Policy", value: buildCsp(isProduction) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  ];

  if (isProduction) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }

  return headers;
}

/** Hostname only (no scheme) — the shape Next's experimental.serverActions.allowedOrigins
 * expects. Returns undefined for a missing/invalid URL so the caller can omit the option
 * entirely rather than passing an empty allowlist. */
export function hostnameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
