import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

const PUBLIC_ROUTES = ["/login"];
// /api/health is Railway's health check target — confirmed by an actual
// container run during this module's build testing that, without this
// exemption, an unauthenticated health check gets a 307 to /login instead
// of the route's own 200, which is exactly the wrong signal for a
// deployment platform deciding whether to keep an instance alive.
const PUBLIC_PREFIXES = ["/api/health"];
// /unsubscribe (Module Six Phase B) must stay reachable with NO redirect in
// either direction: unlike /login, an *authenticated* visitor (e.g. a
// salesperson previewing their own unsubscribe link) must still see the
// page, not get bounced to /dashboard the way PUBLIC_ROUTES would.
const PUBLIC_ALWAYS_ROUTES = ["/unsubscribe"];

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
