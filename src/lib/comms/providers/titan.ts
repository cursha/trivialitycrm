import nodemailer from "nodemailer";
import { callEmailProvider } from "./http";
import type {
  EmailProvider,
  OAuthTokens,
  ConnectedAccount,
  SendEmailInput,
  SendEmailResult,
  CalendarEventResult,
  InboundSubscription,
  ParsedInboundNotification,
  InboundMessage,
} from "./types";

// Deliberately no `import "server-only"` — the worker's send-job handler
// needs this; see token-crypto.ts for the same reasoning.

// Titan's documented SMTP settings (support.titan.email) — no OAuth, no
// REST API, no IMAP. EU-hosted mailboxes use a different host
// (smtp0101.titan.email); this app only supports the standard host today.
// A user must also have enabled "Titan on other apps" in their own webmail
// settings before SMTP AUTH will succeed — this app cannot do that for
// them, and a wrong-password-shaped error from Titan may actually mean
// that toggle is still off.
const SMTP_HOST = "smtp.titan.email";
const SMTP_PORT = 465;

function transportFor(account: ConnectedAccount) {
  if (!account.accountEmail) {
    throw new Error("Titan requires the connected account's email address as the SMTP username — none was provided.");
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: { user: account.accountEmail, pass: account.accessToken },
    // Nodemailer has no AbortSignal support, so callEmailProvider's signal
    // can't bound a hung connection the way a fetch-based provider's can —
    // these are nodemailer's own timeout knobs instead, kept well under
    // callEmailProvider's default 30s so a genuinely stuck TCP/TLS
    // handshake still fails predictably rather than hanging the caller.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

/**
 * Verifies a Titan email+password can actually authenticate over SMTP,
 * without sending anything — the password-auth equivalent of what a
 * successful OAuth code exchange already proves for Microsoft/Google.
 * Used only by the connect action (settings/email-connections), never as
 * part of the EmailProvider interface itself (no other provider's connect
 * flow needs a standalone "test these credentials" step). Always succeeds
 * as a no-op under NODE_ENV=test, matching getEmailProvider()'s own
 * test-mode guarantee that no automated test ever makes a real network
 * call to a real provider.
 */
export async function verifyTitanCredentials(email: string, password: string): Promise<void> {
  if (process.env.NODE_ENV === "test") return;

  const transport = transportFor({ accessToken: password, refreshToken: "", accountEmail: email });
  try {
    await transport.verify();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not sign in to ${email} via Titan — check the password, and confirm "Enable Titan on other apps" is turned on in Titan's webmail settings. (${message})`,
    );
  }
}

/** RFC 2822 header values must not contain raw CR/LF — same header-
 * injection guard google.ts's buildMimeMessage applies. */
function encodeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

export class TitanProvider implements EmailProvider {
  readonly name = "titan" as const;

  getAuthorizationUrl(): string {
    throw new Error("Titan Email uses password authentication, not OAuth — connect it from settings/email-connections' password form instead.");
  }

  async exchangeCodeForTokens(): Promise<OAuthTokens & { accountEmail: string }> {
    throw new Error("Titan Email uses password authentication, not OAuth — see verifyTitanCredentials() instead.");
  }

  async refreshAccessToken(): Promise<OAuthTokens> {
    throw new Error("Titan Email uses password authentication — there is no token to refresh.");
  }

  async sendEmail(account: ConnectedAccount, input: SendEmailInput): Promise<SendEmailResult> {
    const transport = transportFor(account);

    const info = await callEmailProvider({ providerName: "titan", connectionId: account.connectionId }, async () => {
      return transport.sendMail({
        from: account.accountEmail,
        to: input.to.map(encodeHeaderValue).join(", "),
        cc: input.cc && input.cc.length > 0 ? input.cc.map(encodeHeaderValue).join(", ") : undefined,
        bcc: input.bcc && input.bcc.length > 0 ? input.bcc.map(encodeHeaderValue).join(", ") : undefined,
        subject: encodeHeaderValue(input.subject),
        html: input.bodyHtml,
      });
    });

    // SMTP has no concept of a provider-assigned thread id (that's an
    // API-layer construct Graph/Gmail add on top of plain RFC 2822) — a
    // Titan-sent message's providerThreadId is always absent, matching how
    // this app already treats a message with no known thread elsewhere.
    return { providerMessageId: info.messageId };
  }

  /**
   * Titan exposes no calendar API at all (confirmed — it's a mailbox-
   * hosting product, not a groupware suite with a programmatic surface).
   * Thrown clearly rather than silently no-op, same reasoning as Google's
   * inbound-sync stubs below — a Titan-connected user simply can't use the
   * Appointments panel; the UI is expected to hide/disable it for a TITAN
   * connection rather than let this throw surface as a raw error.
   */
  async createCalendarEvent(): Promise<CalendarEventResult> {
    throw new Error("Titan Email has no calendar API — calendar scheduling is unavailable for a Titan-connected mailbox.");
  }

  async updateCalendarEvent(): Promise<void> {
    throw new Error("Titan Email has no calendar API — calendar scheduling is unavailable for a Titan-connected mailbox.");
  }

  async cancelCalendarEvent(): Promise<void> {
    throw new Error("Titan Email has no calendar API — calendar scheduling is unavailable for a Titan-connected mailbox.");
  }

  /**
   * Titan has no IMAP, no webhook/push mechanism, and no REST API at all —
   * unlike Gmail (where inbound sync is merely unbuilt pending GCP Pub/Sub
   * infrastructure, see google.ts), there is no seam here to fill in
   * later. This is a permanent limitation of the provider itself, not a
   * scoped-out phase.
   */
  async createInboundSubscription(): Promise<InboundSubscription> {
    throw new Error("Titan Email has no API for inbound sync — reply/bounce detection is permanently unavailable for a Titan-connected mailbox.");
  }

  async renewInboundSubscription(): Promise<InboundSubscription> {
    throw new Error("Titan Email has no API for inbound sync — see createInboundSubscription's doc comment.");
  }

  async cancelInboundSubscription(): Promise<void> {
    throw new Error("Titan Email has no API for inbound sync — see createInboundSubscription's doc comment.");
  }

  parseInboundWebhookPayload(): ParsedInboundNotification[] {
    throw new Error("Titan Email has no API for inbound sync — see createInboundSubscription's doc comment.");
  }

  async fetchInboundMessage(): Promise<InboundMessage> {
    throw new Error("Titan Email has no API for inbound sync — see createInboundSubscription's doc comment.");
  }
}
