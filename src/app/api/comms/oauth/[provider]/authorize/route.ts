import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { isConnectableProvider } from "@/lib/comms/provider-kind";

/**
 * Redirects the browser to the provider's OAuth consent screen. `state` is
 * a random, single-use CSRF token stored in a short-lived httpOnly cookie
 * (never in the URL alone) and checked against the value the callback
 * route receives — the standard "cookie set during authorize, compared at
 * callback" pattern, since only the same browser that received this
 * redirect can present that cookie back.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await requireUser();
  requirePermission(user, "connect_mailbox");

  const { provider } = await params;
  if (!isConnectableProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  const emailProvider = getEmailProvider(provider);
  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/comms/oauth/${provider}/callback`;
  const state = crypto.randomBytes(32).toString("base64url");

  let authorizationUrl: string;
  try {
    authorizationUrl = emailProvider.getAuthorizationUrl(state, redirectUri);
  } catch (error) {
    const message = error instanceof Error ? error.message : "This provider is not configured.";
    return NextResponse.redirect(new URL(`/settings/email-connections?error=${encodeURIComponent(message)}`, origin));
  }

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(`oauth_state_${provider}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
  return response;
}
