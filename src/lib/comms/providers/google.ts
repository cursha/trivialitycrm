import { getEnv } from "@/lib/env";
import { callEmailProvider } from "./http";
import type {
  EmailProvider,
  OAuthTokens,
  ConnectedAccount,
  SendEmailInput,
  SendEmailResult,
  CalendarEventInput,
  CalendarEventResult,
} from "./types";

// Deliberately no `import "server-only"` — the worker's send-job handler
// needs this; see token-crypto.ts for the same reasoning.

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// gmail.send + gmail.readonly cover Phase A (send) and a later inbound-sync
// phase; calendar is requested now for the same one-consent reason as the
// Microsoft provider (see microsoft-graph.ts's identical comment).
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function requireCredentials(): { clientId: string; clientSecret: string } {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = getEnv();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not configured — the Google provider is unavailable.");
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET };
}

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
};

/** RFC 2822 header values must not contain raw CR/LF or non-ASCII bytes —
 * this mirrors validateOutgoingEmail's header-injection check at the MIME
 * layer too, defense in depth for a value that's already been validated
 * once upstream. */
function encodeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

function buildMimeMessage(input: SendEmailInput): string {
  const headers = [
    `To: ${input.to.map(encodeHeaderValue).join(", ")}`,
    input.cc && input.cc.length > 0 ? `Cc: ${input.cc.map(encodeHeaderValue).join(", ")}` : null,
    input.bcc && input.bcc.length > 0 ? `Bcc: ${input.bcc.map(encodeHeaderValue).join(", ")}` : null,
    `Subject: =?utf-8?B?${Buffer.from(encodeHeaderValue(input.subject), "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
  ].filter((line): line is string => line !== null);

  return `${headers.join("\r\n")}\r\n\r\n${input.bodyHtml}`;
}

/** Gmail's `raw` field is standard base64 with URL-safe characters and no
 * padding — distinct from the base64 used elsewhere in this codebase. */
function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class GoogleProvider implements EmailProvider {
  readonly name = "google" as const;

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const { clientId } = requireCredentials();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      // Both required to reliably receive a refresh_token — without them
      // Google only returns one on the very first-ever consent for that app.
      access_type: "offline",
      prompt: "consent",
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens & { accountEmail: string }> {
    const { clientId, clientSecret } = requireCredentials();

    const tokens = await callEmailProvider({ providerName: "google" }, async (signal) => {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Google token exchange failed (${response.status}).`);
      }
      return (await response.json()) as GoogleTokenResponse;
    });

    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token — this account may have already granted consent previously. Revoke access at myaccount.google.com/permissions and reconnect.",
      );
    }

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

    const tokens = await callEmailProvider({ providerName: "google" }, async (signal) => {
      const response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Google token refresh failed (${response.status}).`);
      }
      return (await response.json()) as GoogleTokenResponse;
    });

    return {
      accessToken: tokens.access_token,
      // Google does not re-issue a refresh_token on a plain refresh — the
      // original one remains valid and must be kept.
      refreshToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scopes: tokens.scope.split(" "),
    };
  }

  private async fetchAccountEmail(accessToken: string): Promise<string> {
    return callEmailProvider({ providerName: "google" }, async (signal) => {
      const response = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (!response.ok) {
        throw new Error(`Fetching the connected Google account's email failed (${response.status}).`);
      }
      const body = (await response.json()) as { email: string };
      return body.email;
    });
  }

  async sendEmail(account: ConnectedAccount, input: SendEmailInput): Promise<SendEmailResult> {
    const raw = base64UrlEncode(buildMimeMessage(input));

    const sent = await callEmailProvider({ providerName: "google", connectionId: account.connectionId }, async (signal) => {
      const response = await fetch(GMAIL_SEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Sending via Gmail failed (${response.status}).`);
      }
      return (await response.json()) as { id: string; threadId: string };
    });

    return { providerMessageId: sent.id, providerThreadId: sent.threadId };
  }

  private eventBody(input: CalendarEventInput) {
    return {
      summary: input.title,
      // Google's Calendar API accepts a full RFC3339 instant directly
      // (unlike Graph, which wants a bare wall-clock string) — `timeZone`
      // here is for the attendees' display, not reinterpretation of the
      // instant itself.
      start: { dateTime: input.startAt.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.endAt.toISOString(), timeZone: input.timezone },
      attendees: input.attendeeEmails.map((email) => ({ email })),
    };
  }

  async createCalendarEvent(account: ConnectedAccount, input: CalendarEventInput): Promise<CalendarEventResult> {
    const event = await callEmailProvider(
      { providerName: "google", connectionId: account.connectionId, bucketPrefix: "calendar" },
      async (signal) => {
        const response = await fetch(`${CALENDAR_EVENTS_URL}?sendUpdates=all`, {
          method: "POST",
          headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(this.eventBody(input)),
          signal,
        });
        if (!response.ok) {
          throw new Error(`Creating the Google calendar event failed (${response.status}).`);
        }
        return (await response.json()) as { id: string };
      },
    );
    return { providerEventId: event.id };
  }

  async updateCalendarEvent(account: ConnectedAccount, providerEventId: string, input: CalendarEventInput): Promise<void> {
    await callEmailProvider(
      { providerName: "google", connectionId: account.connectionId, bucketPrefix: "calendar" },
      async (signal) => {
        const response = await fetch(`${CALENDAR_EVENTS_URL}/${providerEventId}?sendUpdates=all`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(this.eventBody(input)),
          signal,
        });
        if (!response.ok) {
          throw new Error(`Updating the Google calendar event failed (${response.status}).`);
        }
      },
    );
  }

  async cancelCalendarEvent(account: ConnectedAccount, providerEventId: string): Promise<void> {
    await callEmailProvider(
      { providerName: "google", connectionId: account.connectionId, bucketPrefix: "calendar" },
      async (signal) => {
        const response = await fetch(`${CALENDAR_EVENTS_URL}/${providerEventId}?sendUpdates=all`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${account.accessToken}` },
          signal,
        });
        // Google returns 410 Gone if the event was already deleted/cancelled
        // — treat that as success (idempotent cancel), not a failure.
        if (!response.ok && response.status !== 410) {
          throw new Error(`Cancelling the Google calendar event failed (${response.status}).`);
        }
      },
    );
  }
}
