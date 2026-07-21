import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockEmailProvider, SIMULATED_CALENDAR_FAILURE_TITLE } from "../../src/lib/comms/providers/mock";
import { MicrosoftGraphProvider } from "../../src/lib/comms/providers/microsoft-graph";
import { GoogleProvider } from "../../src/lib/comms/providers/google";
import { getEmailProvider } from "../../src/lib/comms/providers/factory";
import { resetEnvCacheForTests } from "../../src/lib/env";
import type { EmailProvider } from "../../src/lib/comms/providers/types";

const mutableEnv = process.env as Record<string, string | undefined>;

describe("MockEmailProvider", () => {
  it("never returns a real-looking provider message id and requires no network access", async () => {
    // Typed as the interface, not the concrete class — call sites in real
    // code (the OAuth callback route) always go through EmailProvider, so
    // this exercises the same arity every real caller does.
    const provider: EmailProvider = new MockEmailProvider();
    const tokens = await provider.exchangeCodeForTokens("some-code", "https://app.example.com/callback");
    expect(tokens.accountEmail).toContain("@");
    expect(tokens.accessToken).toContain("mock-");

    const result = await provider.sendEmail(
      { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      { to: ["lead@example.com"], subject: "Hi", bodyHtml: "<p>Hi</p>" },
    );
    expect(result.providerMessageId).toContain("mock-msg-");
  });

  it("produces a distinct authorization URL per state value (CSRF protection)", () => {
    const provider = new MockEmailProvider();
    const first = provider.getAuthorizationUrl("state-a", "https://app.example.com/callback");
    const second = provider.getAuthorizationUrl("state-b", "https://app.example.com/callback");
    expect(first).not.toBe(second);
    expect(first).toContain("state-a");
  });

  it("creates, updates, and cancels a calendar event with no network access", async () => {
    const provider: EmailProvider = new MockEmailProvider();
    const account = { accessToken: "token", refreshToken: "refresh" };
    const input = { title: "Demo", startAt: new Date(), endAt: new Date(), timezone: "America/Toronto", attendeeEmails: ["lead@example.com"] };

    const created = await provider.createCalendarEvent(account, input);
    expect(created.providerEventId).toContain("mock-event-");

    await expect(provider.updateCalendarEvent(account, created.providerEventId, input)).resolves.toBeUndefined();
    await expect(provider.cancelCalendarEvent(account, created.providerEventId)).resolves.toBeUndefined();
  });

  it("simulates a calendar provider failure for a specific title, the only way tests exercise Appointment's ERROR path", async () => {
    const provider: EmailProvider = new MockEmailProvider();
    const account = { accessToken: "token", refreshToken: "refresh" };
    const input = {
      title: SIMULATED_CALENDAR_FAILURE_TITLE,
      startAt: new Date(),
      endAt: new Date(),
      timezone: "America/Toronto",
      attendeeEmails: [],
    };

    await expect(provider.createCalendarEvent(account, input)).rejects.toThrow(/Simulated calendar provider failure/);
  });
});

describe("MicrosoftGraphProvider.getAuthorizationUrl", () => {
  let savedId: string | undefined;
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedId = mutableEnv.MICROSOFT_CLIENT_ID;
    savedSecret = mutableEnv.MICROSOFT_CLIENT_SECRET;
    mutableEnv.MICROSOFT_CLIENT_ID = "test-client-id";
    mutableEnv.MICROSOFT_CLIENT_SECRET = "test-client-secret";
    resetEnvCacheForTests();
  });

  afterEach(() => {
    if (savedId === undefined) delete mutableEnv.MICROSOFT_CLIENT_ID;
    else mutableEnv.MICROSOFT_CLIENT_ID = savedId;
    if (savedSecret === undefined) delete mutableEnv.MICROSOFT_CLIENT_SECRET;
    else mutableEnv.MICROSOFT_CLIENT_SECRET = savedSecret;
    resetEnvCacheForTests();
  });

  it("builds a Microsoft identity platform URL with the required scopes and state", () => {
    const provider = new MicrosoftGraphProvider();
    const url = new URL(provider.getAuthorizationUrl("csrf-token-123", "https://app.example.com/callback/microsoft"));

    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("state")).toBe("csrf-token-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/callback/microsoft");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("Calendars.ReadWrite");
  });

  it("throws a clear error when Microsoft credentials are not configured", () => {
    delete mutableEnv.MICROSOFT_CLIENT_ID;
    delete mutableEnv.MICROSOFT_CLIENT_SECRET;
    resetEnvCacheForTests();

    const provider = new MicrosoftGraphProvider();
    expect(() => provider.getAuthorizationUrl("state", "https://app.example.com/callback")).toThrow(/MICROSOFT_CLIENT_ID/);
  });
});

describe("GoogleProvider.getAuthorizationUrl", () => {
  let savedId: string | undefined;
  let savedSecret: string | undefined;

  beforeEach(() => {
    savedId = mutableEnv.GOOGLE_CLIENT_ID;
    savedSecret = mutableEnv.GOOGLE_CLIENT_SECRET;
    mutableEnv.GOOGLE_CLIENT_ID = "test-client-id";
    mutableEnv.GOOGLE_CLIENT_SECRET = "test-client-secret";
    resetEnvCacheForTests();
  });

  afterEach(() => {
    if (savedId === undefined) delete mutableEnv.GOOGLE_CLIENT_ID;
    else mutableEnv.GOOGLE_CLIENT_ID = savedId;
    if (savedSecret === undefined) delete mutableEnv.GOOGLE_CLIENT_SECRET;
    else mutableEnv.GOOGLE_CLIENT_SECRET = savedSecret;
    resetEnvCacheForTests();
  });

  it("builds a Google OAuth URL requesting offline access and forced consent (required for a refresh token)", () => {
    const provider = new GoogleProvider();
    const url = new URL(provider.getAuthorizationUrl("csrf-token-456", "https://app.example.com/callback/google"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("scope")).toContain("calendar");
  });
});

describe("getEmailProvider", () => {
  it("always returns the mock provider under NODE_ENV=test, even when a real provider kind is requested", () => {
    // This test file itself runs under NODE_ENV=test (Vitest's default) —
    // the exact guarantee this factory exists to provide.
    expect(getEmailProvider("microsoft").name).toBe("mock");
    expect(getEmailProvider("google").name).toBe("mock");
    expect(getEmailProvider("mock").name).toBe("mock");
  });
});
