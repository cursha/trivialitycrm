import crypto from "node:crypto";
import type {
  EmailProvider,
  OAuthTokens,
  SendEmailInput,
  SendEmailResult,
  CalendarEventInput,
  CalendarEventResult,
  InboundSubscription,
  ParsedInboundNotification,
  InboundMessage,
} from "./types";

/** Sending to this address deterministically simulates a provider-side
 * failure — the only way tests can exercise the FAILED/Notification path in
 * src/lib/comms/send-email.ts without a real provider ever failing. */
export const SIMULATED_SEND_FAILURE_ADDRESS = "trigger-send-failure@example.test";

/** Same idea as SIMULATED_SEND_FAILURE_ADDRESS, for calendar operations —
 * an event with this exact title deterministically fails create/update/
 * cancel, the only way tests exercise Appointment's ERROR path. */
export const SIMULATED_CALENDAR_FAILURE_TITLE = "Trigger Calendar Failure";

/** Same idea again, for inbound sync — a notification whose fixture
 * fromAddress is this address deterministically fails fetchInboundMessage,
 * the only way tests exercise process-inbound-notification's failure/retry
 * path without a real provider ever failing. */
export const SIMULATED_INBOUND_FETCH_FAILURE_ADDRESS = "trigger-inbound-fetch-failure@example.test";

const MOCK_INBOUND_ID_PREFIX = "mock-inbound:";

export type MockInboundFixture = {
  subscriptionId: string;
  clientState: string;
  fromAddress: string;
  subject: string;
  bodyHtml: string;
};

/**
 * Builds the raw webhook request body MockEmailProvider.parseInboundWebhookPayload
 * expects — the only way tests can simulate an inbound webhook delivery
 * without a real Graph/Google payload (mirrors SIMULATED_SEND_FAILURE_ADDRESS's
 * role for outbound sends). The real webhook route
 * (src/app/api/comms/webhooks/[provider]/route.ts) never constructs this
 * shape itself — it's purely a test fixture format for the mock provider.
 */
export function buildMockWebhookBody(notifications: MockInboundFixture[]): string {
  return JSON.stringify({ notifications });
}

/** The mock's providerMessageId is a self-describing encoded blob of the
 * fixture content, not an opaque provider-assigned id like a real
 * provider's — MockEmailProvider has no server of its own to look content
 * up from later, and a fresh instance is constructed per call (see
 * factory.ts), so nothing can be held in memory between parse and fetch.
 * Encoding the content directly is also what makes eventId/providerMessageId
 * deterministic for identical fixtures — required for the redelivery-dedup
 * test case (the same fixture posted twice must produce the same ids). */
function encodeMockProviderMessageId(content: { fromAddress: string; subject: string; bodyHtml: string }): string {
  return MOCK_INBOUND_ID_PREFIX + Buffer.from(JSON.stringify(content), "utf8").toString("base64url");
}

/**
 * No network calls, no cost, deterministic-enough fixture data — the only
 * provider active under NODE_ENV=test (see factory.ts) and the default for
 * local dev without real OAuth app registrations configured. Mirrors
 * src/lib/research/providers/mock.ts's role for the AI research pipeline.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = "mock" as const;

  getAuthorizationUrl(state: string, redirectUri: string): string {
    return `https://mock-provider.invalid/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens & { accountEmail: string }> {
    return {
      accessToken: `mock-access-${code}`,
      refreshToken: `mock-refresh-${code}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: ["mock.mail.send", "mock.mail.read"],
      accountEmail: "mock-connected-user@example.test",
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    return {
      accessToken: `mock-access-refreshed-${crypto.randomUUID()}`,
      refreshToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: ["mock.mail.send", "mock.mail.read"],
    };
  }

  async sendEmail(_account: unknown, input: SendEmailInput): Promise<SendEmailResult> {
    if (input.to.includes(SIMULATED_SEND_FAILURE_ADDRESS)) {
      throw new Error("Simulated provider failure for testing.");
    }
    return {
      providerMessageId: `mock-msg-${crypto.randomUUID()}`,
      providerThreadId: `mock-thread-${crypto.randomUUID()}`,
    };
  }

  async createCalendarEvent(_account: unknown, input: CalendarEventInput): Promise<CalendarEventResult> {
    if (input.title === SIMULATED_CALENDAR_FAILURE_TITLE) {
      throw new Error("Simulated calendar provider failure for testing.");
    }
    return { providerEventId: `mock-event-${crypto.randomUUID()}` };
  }

  async updateCalendarEvent(_account: unknown, _providerEventId: string, input: CalendarEventInput): Promise<void> {
    if (input.title === SIMULATED_CALENDAR_FAILURE_TITLE) {
      throw new Error("Simulated calendar provider failure for testing.");
    }
  }

  async cancelCalendarEvent(): Promise<void> {}

  async createInboundSubscription(): Promise<InboundSubscription> {
    return { subscriptionId: `mock-sub-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) };
  }

  async renewInboundSubscription(_account: unknown, subscriptionId: string): Promise<InboundSubscription> {
    return { subscriptionId, expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) };
  }

  async cancelInboundSubscription(): Promise<void> {}

  parseInboundWebhookPayload(rawBody: string): ParsedInboundNotification[] {
    const parsed = JSON.parse(rawBody) as { notifications: MockInboundFixture[] };
    return parsed.notifications.map((notification) => {
      const providerMessageId = encodeMockProviderMessageId({
        fromAddress: notification.fromAddress,
        subject: notification.subject,
        bodyHtml: notification.bodyHtml,
      });
      return {
        eventId: `${notification.subscriptionId}:${providerMessageId}`,
        subscriptionId: notification.subscriptionId,
        clientState: notification.clientState,
        providerMessageId,
      };
    });
  }

  async fetchInboundMessage(_account: unknown, providerMessageId: string): Promise<InboundMessage> {
    if (!providerMessageId.startsWith(MOCK_INBOUND_ID_PREFIX)) {
      throw new Error("Unknown mock inbound message id.");
    }
    const decoded = JSON.parse(
      Buffer.from(providerMessageId.slice(MOCK_INBOUND_ID_PREFIX.length), "base64url").toString("utf8"),
    ) as { fromAddress: string; subject: string; bodyHtml: string };

    if (decoded.fromAddress === SIMULATED_INBOUND_FETCH_FAILURE_ADDRESS) {
      throw new Error("Simulated inbound fetch failure for testing.");
    }

    return {
      providerMessageId,
      fromAddress: decoded.fromAddress,
      subject: decoded.subject,
      bodyHtml: decoded.bodyHtml,
      receivedAt: new Date(),
    };
  }
}
