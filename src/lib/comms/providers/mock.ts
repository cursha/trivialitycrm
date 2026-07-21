import crypto from "node:crypto";
import type { EmailProvider, OAuthTokens, SendEmailInput, SendEmailResult } from "./types";

/** Sending to this address deterministically simulates a provider-side
 * failure — the only way tests can exercise the FAILED/Notification path in
 * src/lib/comms/send-email.ts without a real provider ever failing. */
export const SIMULATED_SEND_FAILURE_ADDRESS = "trigger-send-failure@example.test";

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
}
