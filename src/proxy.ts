import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

const PUBLIC_ROUTES = ["/login"];

// Optimistic check ONLY — this reads whether the session cookie is present,
// not whether it's still valid. Proxy runs on every request (including
// prefetches) and is documented as unsuitable for DB-backed checks, so the
// authoritative, DB-backed session validation happens in requireUser()
// (src/lib/auth/current-user.ts) on every protected page/layout and every
// server action. A cookie's mere presence is never treated as
// authentication beyond this fast pre-filter.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
