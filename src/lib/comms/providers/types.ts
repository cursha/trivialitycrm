// Provider interfaces for connected-mailbox email sending. Every real
// integration (Microsoft Graph, Google) and the mock provider implement
// this same shape, so the composer/send action and OAuth routes never
// depend on a specific vendor — mirrors src/lib/research/providers/types.ts's
// role for the AI research pipeline. Calendar and inbound-sync methods are
// added to this interface in later phases (see the approved Module Six
// plan's §10 phasing), not speculatively included now.

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

export type ConnectedAccount = {
  accessToken: string;
  refreshToken: string;
};

export type SendEmailInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Already-sanitized HTML — providers never see raw user input; see
   * src/lib/comms/sanitize-html.ts, called before this. */
  bodyHtml: string;
};

export type SendEmailResult = {
  providerMessageId: string;
  providerThreadId?: string;
};

export type ProviderName = "mock" | "microsoft" | "google";

export interface EmailProvider {
  readonly name: ProviderName;

  /** Builds the URL the browser redirects to for the provider's OAuth
   * consent screen. `state` must be an unguessable, per-attempt value the
   * callback route verifies to prevent CSRF on the OAuth flow. */
  getAuthorizationUrl(state: string, redirectUri: string): string;

  /** Exchanges a one-time authorization code (from the callback redirect)
   * for tokens, plus the connected account's own email address (read once
   * at connect time, stored on ProviderConnection.providerAccountEmail). */
  exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens & { accountEmail: string }>;

  /** Exchanges a refresh token for a new access token — called when the
   * stored token is expired or about to expire. */
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;

  /** Sends one email as the connected account. Caller (the send action /
   * worker job) is responsible for the consent gate and
   * validateOutgoingEmail() — this method trusts its input is already
   * validated and permitted. */
  sendEmail(account: ConnectedAccount, input: SendEmailInput): Promise<SendEmailResult>;
}
