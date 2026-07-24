import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

// /forgot-password behaves like /login: an already-authenticated visitor is
// bounced to /dashboard (they already have /change-password for that).
const PUBLIC_ROUTES = ["/login", "/forgot-password"];
// /api/health is Railway's health check target — confirmed by an actual
// container run during this module's build testing that, without this
// exemption, an unauthenticated health check gets a 307 to /login instead
// of the route's own 200, which is exactly the wrong signal for a
// deployment platform deciding whether to keep an instance alive.
//
// Module Nine: a manual HTTP smoke test of the new Resend webhook route
// found this same gap already existed for Module Six's inbound comms
// webhook — /api/comms/webhooks/[provider] was never added here, so a real
// unauthenticated POST from Microsoft Graph (or now Resend) would have been
// silently 307'd to /login instead of ever reaching the route handler, in
// any deployed environment. Fixed for both here, not just the new one —
// same middleware, same bug, and now a confirmed one rather than an
// assumed-fine gap (MODULE_6_REPORT.md's own gap notes flagged that no real
// Graph subscription had ever been exercised against a live tenant, which
// is exactly why this was never caught).
const PUBLIC_PREFIXES = ["/api/health", "/api/comms/webhooks", "/api/transactional-email/webhooks"];
// /unsubscribe (Module Six Phase B) and /reset-password must stay reachable
// with NO redirect in either direction: unlike /login, an *authenticated*
// visitor (a salesperson previewing their own unsubscribe link, or someone
// who clicked a reset link while a stale/different session cookie is still
// present) must still see the page, not get bounced to /dashboard the way
// PUBLIC_ROUTES would.
const PUBLIC_ALWAYS_ROUTES = ["/unsubscribe", "/reset-password"];

// Optimistic check ONLY — this reads whether the session cookie is present,
// not whether it's still valid. Proxy runs on every request (including
// prefetches) and is documented as unsuitable for DB-backed checks, so the
// authoritative, DB-backed session validation happens in requireUser()
// (src/lib/auth/current-user.ts) on every protected page/layout and every
// server action. A cookie's mere presence is never treated as
// authentication beyond this fast pre-filter.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || PUBLIC_ALWAYS_ROUTES.includes(pathname)) {
    return NextResponse.next();
  }

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  if (!isPublicRoute && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicRoute && hasSessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
