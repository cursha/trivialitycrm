import { getEnv } from "@/lib/env";
import { callEmailProvider } from "./http";
import type { EmailProvider, OAuthTokens, ConnectedAccount, SendEmailInput, SendEmailResult } from "./types";

// Deliberately no `import "server-only"` — the worker's send-job handler
// needs this; see token-crypto.ts for the same reasoning.

const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// offline_access is required to receive a refresh_token at all. Mail.Send +
// Mail.Read cover Phase A (send + read-for-inbound-sync in a later phase);
// Calendars.ReadWrite is requested now too since Microsoft grants calendar
// scope in the same consent (see the plan's §3) even though calendar
// features aren't built until Phase D — asking once up front avoids making
// a connected user re-consent later.
const SCOPES = ["offline_access", "Mail.Send", "Mail.Read", "Calendars.ReadWrite", "User.Read"].join(" ");

function requireCredentials(): { clientId: string; clientSecret: string } {
  const { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } = getEnv();
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
    throw new Error("MICROSOFT_CLIENT_ID/MICROSOFT_CLIENT_SECRET are not configured — the Microsoft provider is unavailable.");
  }
  return { clientId: MICROSOFT_CLIENT_ID, clientSecret: MICROSOFT_CLIENT_SECRET };
}

type GraphTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
};

export class MicrosoftGraphProvider implements EmailProvider {
  readonly name = "microsoft" as const;

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const { clientId } = requireCredentials();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: SCOPES,
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens & { accountEmail: string }> {
    const { clientId, clientSecret } = requireCredentials();

    const tokens = await callEmailProvider({ providerName: "microsoft" }, async (signal) => {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          scope: SCOPES,
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Microsoft token exchange failed (${response.status}).`);
      }
      return (await response.json()) as GraphTokenResponse;
    });

    const accountEmail = await this.fetchAccountEmail(tokens.access_token);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope.split(" "),
      accountEmail,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const { clientId, clientSecret } = requireCredentials();

    const tokens = await callEmailProvider({ providerName: "microsoft" }, async (signal) => {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: SCOPES,
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Microsoft token refresh failed (${response.status}).`);
      }
      return (await response.json()) as GraphTokenResponse;
    });

    return {
      accessToken: tokens.access_token,
      // Microsoft may or may not rotate the refresh token on refresh —
      // fall back to the existing one if a new one wasn't issued.
      refreshToken: tokens.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope.split(" "),
    };
  }

  private async fetchAccountEmail(accessToken: string): Promise<string> {
    return callEmailProvider({ providerName: "microsoft" }, async (signal) => {
      const response = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (!response.ok) {
        throw new Error(`Fetching the connected Microsoft account's email failed (${response.status}).`);
      }
      const body = (await response.json()) as { mail: string | null; userPrincipalName: string };
      return body.mail ?? body.userPrincipalName;
    });
  }

  /**
   * Graph's POST /me/sendMail returns 202 Accepted with no body at all —
   * it never hands back a message id. To get one (needed for
   * EmailMessage.providerMessageId / providerThreadId, and for future
   * delivery-status correlation), this uses the documented
   * create-draft-then-send pattern instead: create the message as a draft
   * (its id is in the response), then POST its /send action.
   */
  async sendEmail(account: ConnectedAccount, input: SendEmailInput): Promise<SendEmailResult> {
    const draft = await callEmailProvider({ providerName: "microsoft", connectionId: account.connectionId }, async (signal) => {
      const response = await fetch(`${GRAPH_BASE}/me/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: input.subject,
          body: { contentType: "HTML", content: input.bodyHtml },
          toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
          ccRecipients: (input.cc ?? []).map((address) => ({ emailAddress: { address } })),
          bccRecipients: (input.bcc ?? []).map((address) => ({ emailAddress: { address } })),
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Creating the Microsoft draft message failed (${response.status}).`);
      }
      return (await response.json()) as { id: string; conversationId: string };
    });

    await callEmailProvider({ providerName: "microsoft", connectionId: account.connectionId }, async (signal) => {
      const response = await fetch(`${GRAPH_BASE}/me/messages/${draft.id}/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${account.accessToken}` },
        signal,
      });
      if (!response.ok) {
        throw new Error(`Sending the Microsoft draft message failed (${response.status}).`);
      }
    });

    return { providerMessageId: draft.id, providerThreadId: draft.conversationId };
  }
}
