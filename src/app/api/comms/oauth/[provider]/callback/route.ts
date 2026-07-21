import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { getEmailProvider } from "@/lib/comms/providers/factory";
import { isConnectableProvider, providerKindFromSlug } from "@/lib/comms/provider-kind";
import { encryptToken } from "@/lib/comms/token-crypto";

const SETTINGS_PATH = "/settings/email-connections";

/**
 * Handles the redirect back from the provider's consent screen. Verifies
 * the CSRF state cookie before doing anything else, exchanges the
 * authorization code for tokens, encrypts them (never stores plaintext —
 * see token-crypto.ts), and upserts this user's single ProviderConnection
 * row (unique on userId, so a user can only ever connect their own
 * mailbox — see the model's doc comment in schema.prisma). Logs only ids
 * and the provider name on failure, never the account email or any token.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await requireUser();
  requirePermission(user, "connect_mailbox");

  const { provider } = await params;
  const url = new URL(request.url);

  if (!isConnectableProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(`oauth_state_${provider}`)?.value;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  const failRedirect = (reason: string) => {
    const response = NextResponse.redirect(new URL(`${SETTINGS_PATH}?error=${encodeURIComponent(reason)}`, url.origin));
    response.cookies.delete(`oauth_state_${provider}`);
    return response;
  };

  if (providerError) {
    return failRedirect(`The provider declined the connection (${providerError}).`);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return failRedirect("The connection attempt could not be verified — please try connecting again.");
  }

  const emailProvider = getEmailProvider(provider);
  const redirectUri = `${url.origin}/api/comms/oauth/${provider}/callback`;

  try {
    const tokens = await emailProvider.exchangeCodeForTokens(code, redirectUri);

    await prisma.providerConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        provider: providerKindFromSlug(provider),
        providerAccountEmail: tokens.accountEmail,
        encryptedAccessToken: encryptToken(tokens.accessToken),
        encryptedRefreshToken: encryptToken(tokens.refreshToken),
        scopes: tokens.scopes,
        tokenExpiresAt: tokens.expiresAt,
        status: "CONNECTED",
      },
      update: {
        provider: providerKindFromSlug(provider),
        providerAccountEmail: tokens.accountEmail,
        encryptedAccessToken: encryptToken(tokens.accessToken),
        encryptedRefreshToken: encryptToken(tokens.refreshToken),
        scopes: tokens.scopes,
        tokenExpiresAt: tokens.expiresAt,
        status: "CONNECTED",
        lastError: null,
        disconnectedAt: null,
      },
    });
  } catch (error) {
    logger.error({ err: error, userId: user.id, provider }, "OAuth token exchange failed");
    return failRedirect("Connecting your mailbox failed — please try again.");
  }

  const response = NextResponse.redirect(new URL(`${SETTINGS_PATH}?connected=1`, url.origin));
  response.cookies.delete(`oauth_state_${provider}`);
  return response;
}
