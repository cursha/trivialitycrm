import { describe, it, expect, vi, beforeEach } from "vitest";

// No real SMTP and no rate-limit DB round trip: capture what the provider
// would hand to nodemailer instead.
const sendMail = vi.fn(async () => ({ messageId: "<test@titan>" }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
vi.mock("../../src/lib/comms/providers/http", () => ({
  callEmailProvider: async (_options: unknown, fn: (signal: AbortSignal) => Promise<unknown>) => fn(new AbortController().signal),
}));

const { TitanProvider } = await import("../../src/lib/comms/providers/titan");

type SentMail = { from: unknown; to: string; subject: string; html: string; icalEvent: { method: string; content: string } };

function lastMail(): SentMail {
  const calls = sendMail.mock.calls as unknown as [SentMail][];
  return calls[calls.length - 1][0];
}

function icsLines(mail: SentMail): string[] {
  return mail.icalEvent.content.replace(/\r\n /g, "").split("\r\n");
}

const account = { accessToken: "pw", refreshToken: "", accountEmail: "rep@example.test" };
const input = {
  title: "Triviality demo: The Rusty Nail",
  startAt: new Date("2026-10-06T20:00:00.000Z"),
  endAt: new Date("2026-10-06T20:20:00.000Z"),
  timezone: "America/Denver",
  attendeeEmails: ["Owner@Example.test"],
  location: "123 Main St, Colorado Springs, CO",
  organizerName: "Pat Rep",
};

beforeEach(() => {
  sendMail.mockClear();
});

describe("TitanProvider calendar invites", () => {
  it("creates an event by emailing a METHOD:REQUEST invite to the attendees and the organizer", async () => {
    const provider = new TitanProvider();
    const { providerEventId } = await provider.createCalendarEvent(account, input);

    expect(providerEventId).toMatch(/@trivialitycrm$/);
    const mail = lastMail();
    expect(mail.to).toBe("owner@example.test, rep@example.test");
    expect(mail.subject).toBe("Invitation: Triviality demo: The Rusty Nail");
    expect(mail.icalEvent.method).toBe("REQUEST");
    const lines = icsLines(mail);
    expect(lines).toContain(`UID:${providerEventId}`);
    expect(lines).toContain("DTSTART:20261006T200000Z");
    expect(lines).toContain("LOCATION:123 Main St\\, Colorado Springs\\, CO");
    // The HTML body shows the time in the appointment's own zone.
    expect(mail.html).toContain("2:00");
    expect(mail.html).toContain("America/Denver");
  });

  it("updates under the same UID with a higher SEQUENCE", async () => {
    const provider = new TitanProvider();
    const { providerEventId } = await provider.createCalendarEvent(account, input);
    const firstSequence = Number(icsLines(lastMail()).find((l) => l.startsWith("SEQUENCE:"))?.slice(9));

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 5_000));
    try {
      await provider.updateCalendarEvent(account, providerEventId, { ...input, startAt: new Date("2026-10-07T20:00:00.000Z") });
    } finally {
      vi.useRealTimers();
    }

    const lines = icsLines(lastMail());
    expect(lines).toContain(`UID:${providerEventId}`);
    expect(lines).toContain("METHOD:REQUEST");
    expect(lines).toContain("DTSTART:20261007T200000Z");
    expect(Number(lines.find((l) => l.startsWith("SEQUENCE:"))?.slice(9))).toBeGreaterThan(firstSequence);
  });

  it("cancels by emailing a METHOD:CANCEL for the same UID", async () => {
    const provider = new TitanProvider();
    await provider.cancelCalendarEvent(account, "event-1@trivialitycrm", input);

    const mail = lastMail();
    expect(mail.subject).toBe("Cancelled: Triviality demo: The Rusty Nail");
    expect(mail.icalEvent.method).toBe("CANCEL");
    expect(icsLines(mail)).toContain("UID:event-1@trivialitycrm");
    expect(icsLines(mail)).toContain("STATUS:CANCELLED");
  });

  it("refuses to cancel without the event details it needs to address the cancellation", async () => {
    const provider = new TitanProvider();
    await expect(provider.cancelCalendarEvent(account, "event-1@trivialitycrm")).rejects.toThrow(/event details/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("still sends to the organizer alone when there are no attendees", async () => {
    const provider = new TitanProvider();
    await provider.createCalendarEvent(account, { ...input, attendeeEmails: [] });
    expect(lastMail().to).toBe("rep@example.test");
  });

  it("escapes the title in the HTML body", async () => {
    const provider = new TitanProvider();
    await provider.createCalendarEvent(account, { ...input, title: "<script>alert(1)</script>" });
    expect(lastMail().html).not.toContain("<script>");
  });
});
