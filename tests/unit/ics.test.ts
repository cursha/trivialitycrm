import { describe, it, expect } from "vitest";
import { buildIcsEvent, icsSequence } from "../../src/lib/comms/ics";

const base = {
  method: "REQUEST" as const,
  uid: "abc-123@trivialitycrm",
  sequence: 7,
  startAt: new Date("2026-10-06T20:00:00.000Z"),
  endAt: new Date("2026-10-06T20:20:00.000Z"),
  summary: "Triviality demo: The Rusty Nail",
  organizer: { email: "rep@example.test", name: "Pat Rep" },
  attendeeEmails: ["owner@example.test"],
  dtstamp: new Date("2026-10-01T12:00:00.000Z"),
};

function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n");
}

describe("buildIcsEvent", () => {
  it("builds a REQUEST invite with UTC times, organizer and attendees", () => {
    const lines = unfold(buildIcsEvent(base));
    expect(lines).toContain("METHOD:REQUEST");
    expect(lines).toContain("UID:abc-123@trivialitycrm");
    expect(lines).toContain("SEQUENCE:7");
    expect(lines).toContain("DTSTAMP:20261001T120000Z");
    expect(lines).toContain("DTSTART:20261006T200000Z");
    expect(lines).toContain("DTEND:20261006T202000Z");
    expect(lines).toContain('ORGANIZER;CN="Pat Rep":mailto:rep@example.test');
    expect(lines).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:owner@example.test");
    expect(lines).toContain("STATUS:CONFIRMED");
  });

  it("uses CRLF line endings throughout", () => {
    const ics = buildIcsEvent(base);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("marks a CANCEL as cancelled", () => {
    const lines = unfold(buildIcsEvent({ ...base, method: "CANCEL" }));
    expect(lines).toContain("METHOD:CANCEL");
    expect(lines).toContain("STATUS:CANCELLED");
  });

  it("escapes TEXT values and can't be broken onto a new property line", () => {
    const lines = unfold(
      buildIcsEvent({ ...base, summary: "Demo; with, commas\\slash", location: "123 Main St\r\nATTENDEE:mailto:evil@example.test" }),
    );
    expect(lines).toContain("SUMMARY:Demo\\; with\\, commas\\\\slash");
    expect(lines).toContain("LOCATION:123 Main St\\nATTENDEE:mailto:evil@example.test");
    expect(lines.filter((line) => line.startsWith("ATTENDEE"))).toHaveLength(1);
  });

  it("strips quotes and line breaks from the organizer's display name", () => {
    const lines = unfold(buildIcsEvent({ ...base, organizer: { email: "rep@example.test", name: 'Pat "The Rep"\r\nX' } }));
    expect(lines).toContain('ORGANIZER;CN="Pat The RepX":mailto:rep@example.test');
  });

  it("omits LOCATION/DESCRIPTION and CN when not given", () => {
    const ics = buildIcsEvent({ ...base, organizer: { email: "rep@example.test" } });
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
    expect(unfold(ics)).toContain("ORGANIZER:mailto:rep@example.test");
  });

  it("folds long lines at 75 octets without splitting multi-byte characters", () => {
    const ics = buildIcsEvent({ ...base, location: "Café ".repeat(40) });
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(unfold(ics)).toContain(`LOCATION:${"Café ".repeat(40)}`);
  });
});

describe("icsSequence", () => {
  it("increases over time and stays a small non-negative integer", () => {
    const earlier = icsSequence(new Date("2026-10-01T12:00:00.000Z"));
    const later = icsSequence(new Date("2026-10-01T12:00:05.000Z"));
    expect(later).toBeGreaterThan(earlier);
    expect(Number.isInteger(earlier)).toBe(true);
    expect(icsSequence(new Date("2060-01-01T00:00:00.000Z"))).toBeLessThan(2 ** 31);
    expect(icsSequence(new Date("2019-01-01T00:00:00.000Z"))).toBe(0);
  });
});
