import { getEnv } from "@/lib/env";
import { callEmailProvider } from "./http";
import { formatWallClock } from "@/lib/comms/calendar-time";
import type {
  EmailProvider,
  OAuthTokens,
  ConnectedAccount,
  SendEmailInput,
  SendEmailResult,
  CalendarEventInput,
  CalendarEventResult,
  InboundSubscription,
  ParsedInboundNotification,
  InboundMessage,
} from "./types";

// Deliberately no `import "server-only"` — the worker's send-job handler
// needs this; see token-crypto.ts for the same reasoning.

const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// offline_access is required to receive a refresh_token at all. Mail.Send
// covers outbound (Phase A); Mail.Read covers inbound sync (Phase D2 —
// reading the message a webhook notification points at); Calendars.ReadWrite
// covers calendar (Phase D1). All requested from the very first connection,
// even before every scope's feature existed, since Microsoft grants them in
// one consent — asking once up front avoids making an already-connected
// user re-consent later.
const SCOPES = ["offline_access", "Mail.Send", "Mail.Read", "Calendars.ReadWrite", "User.Read"].join(" ");

/** Graph's documented max lifetime for a subscription on a mail resource is
 * 4230 minutes (~2.94 days) — requesting comfortably under that ceiling. */
const SUBSCRIPTION_LIFETIME_MINUTES = 4200;

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

  private eventBody(input: CalendarEventInput) {
    return {
      subject: input.title,
      start: { dateTime: formatWallClock(input.startAt, input.timezone), timeZone: input.timezone },
      end: { dateTime: formatWallClock(input.endAt, input.timezone), timeZone: input.timezone },
      attendees: input.attendeeEmails.map((address) => ({ emailAddress: { address }, type: "required" })),
    };
  }

  async createCalendarEvent(account: ConnectedAccount, input: CalendarEventInput): Promise<CalendarEventResult> {
    const event = await callEmailProvider(
      { providerName: "microsoft", connectionId: account.connectionId, bucketPrefix: "calendar" },
      async (signal) => {
        const response = await fetch(`${GRAPH_BASE}/me/events`, {
          method: "POST",
          headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(this.eventBody(input)),
          signal,
        });
        if (!response.ok) {
          throw new Error(`Creating the Microsoft calendar event failed (${response.status}).`);
        }
        return (await response.json()) as { id: string };
      },
    );
    return { providerEventId: event.id };
  }

  async updateCalendarEvent(account: ConnectedAccount, providerEventId: string, input: CalendarEventInput): Promise<void> {
    await callEmailProvider(
      { providerName: "microsoft", connectionId: account.connectionId, bucketPrefix: "calendar" },
      async (signal) => {
        const response = await fetch(`${GRAPH_BASE}/me/events/${providerEventId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(this.eventBody(input)),
          signal,
        });
        if (!response.ok) {
          throw new Error(`Updating the Microsoft calendar event failed (${response.status}).`);
        }
      },
    );
  }

  /** Graph's documented way to cancel a meeting you organize while
   * notifying attendees — a bare DELETE removes the event but doesn't
   * reliably send attendees a cancellation notice. */
  async cancelCalendarEvent(account: ConnectedAccount, providerEventId: string): Promise<void> {
    await callEmailProvider(
      { providerName: "microsoft", connectionId: account.connectionId, bucketPrefix: "calendar" },
      async (signal) => {
        const response = await fetch(`${GRAPH_BASE}/me/events/${providerEventId}/cancel`, {
          method: "POST",
          headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ comment: "" }),
          signal,
        });
        if (!response.ok) {
          throw new Error(`Cancelling the Microsoft calendar event failed (${response.status}).`);
        }
      },
    );
  }

  async createInboundSubscription(account: ConnectedAccount, notificationUrl: string, clientState: string): Promise<InboundSubscription> {
    const subscription = await callEmailProvider(
      { providerName: "microsoft", connectionId: account.connectionId, bucketPrefix: "webhook-subscription" },
      async (signal) => {
        const response = await fetch(`${GRAPH_BASE}/subscriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            changeType: "created",
            notificationUrl,
            resource: "me/mailFolders('inbox')/messages",
            expirationDateTime: new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000).toISOString(),
            clientState,
          }),
          signal,
        });
        if (!response.ok) {
          throw new Error(`Creating the Microsoft inbound subscription failed (${response.status}).`);
        }
        return (await response.json()) as { id: string; expirationDateTime: string };
      },
    );
    return { subscriptionId: subscription.id, expiresAt: new Date(subscription.expirationDateTime) };
  }

  async renewInboundSubscription(account: ConnectedAccount, subscriptionId: string): Promise<InboundSubscription> {
    const subscription = await callEmailProvider(
      { providerName: "microsoft", connectionId: account.connectionId, bucketPrefix: "webhook-subscription" },
      async (signal) => {
        const response = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            expirationDateTime: new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60 * 1000).toISOString(),
          }),
          signal,
        });
        if (!response.ok) {
          throw new Error(`Renewing the Microsoft inbound subscription failed (${response.status}).`);
        }
        return (await response.json()) as { id: string; expirationDateTime: string };
      },
    );
    return { subscriptionId: subscription.id, expiresAt: new Date(subscription.expirationDateTime) };
  }

  async cancelInboundSubscription(account: ConnectedAccount, subscriptionId: string): Promise<void> {
    await callEmailProvider(
      { providerName: "microsoft", connectionId: account.connectionId, bucketPrefix: "webhook-subscription" },
      async (signal) => {
        const response = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${account.accessToken}` },
          signal,
        });
        // 404 means the subscription is already gone (expired or already
        // cancelled) — treat as success, same idempotency reasoning as
        // appointments.ts's cancelAppointment.
        if (!response.ok && response.status !== 404) {
          throw new Error(`Cancelling the Microsoft inbound subscription failed (${response.status}).`);
        }
      },
    );
  }

  /**
   * Graph's change-notification envelope: `{ value: [{ subscriptionId,
   * clientState, changeType, resourceData: { id } }] }`. There is no
   * single canonical notification id in this payload, so eventId is
   * synthesized from (subscriptionId, message id) — stable across a
   * genuine redelivery of the same notification, which is exactly the
   * dedup key WebhookEvent needs. Only "created" entries are surfaced
   * (the subscription itself only ever requests that changeType, but
   * filtering here costs nothing and documents the assumption).
   */
  parseInboundWebhookPayload(rawBody: string): ParsedInboundNotification[] {
    const parsed = JSON.parse(rawBody) as {
      value: Array<{ subscriptionId: string; clientState: string; changeType: string; resourceData: { id: string } }>;
    };
    return parsed.value
      .filter((entry) => entry.changeType === "created")
      .map((entry) => ({
        eventId: `${entry.subscriptionId}:${entry.resourceData.id}`,
        subscriptionId: entry.subscriptionId,
        clientState: entry.clientState,
        providerMessageId: entry.resourceData.id,
      }));
  }

  async fetchInboundMessage(account: ConnectedAccount, providerMessageId: string): Promise<InboundMessage> {
    const message = await callEmailProvider(
      { providerName: "microsoft", connectionId: account.connectionId, bucketPrefix: "inbound-fetch" },
      async (signal) => {
        const response = await fetch(
          `${GRAPH_BASE}/me/messages/${providerMessageId}?$select=from,subject,body,receivedDateTime,conversationId`,
          { headers: { Authorization: `Bearer ${account.accessToken}` }, signal },
        );
        if (!response.ok) {
          throw new Error(`Fetching the Microsoft inbound message failed (${response.status}).`);
        }
        return (await response.json()) as {
          from: { emailAddress: { address: string } };
          subject: string;
          body: { content: string };
          receivedDateTime: string;
          conversationId: string;
        };
      },
    );
    return {
      providerMessageId,
      providerThreadId: message.conversationId,
      fromAddress: message.from.emailAddress.address,
      subject: message.subject,
      bodyHtml: message.body.content,
      receivedAt: new Date(message.receivedDateTime),
    };
  }
}
