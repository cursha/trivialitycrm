import { describe, it, expect } from "vitest";
import { formatWallClock, parseWallClock, isValidTimeZone } from "../../src/lib/comms/calendar-time";

describe("formatWallClock", () => {
  it("formats a UTC instant as the local wall-clock time in the given zone", () => {
    // 2026-08-01T18:00:00Z is 2pm in America/Toronto (EDT, UTC-4 in August).
    const instant = new Date("2026-08-01T18:00:00.000Z");
    expect(formatWallClock(instant, "America/Toronto")).toBe("2026-08-01T14:00:00");
  });

  it("produces a different wall-clock string for a different timezone, same instant", () => {
    const instant = new Date("2026-08-01T18:00:00.000Z");
    expect(formatWallClock(instant, "America/Los_Angeles")).toBe("2026-08-01T11:00:00");
  });

  it("crosses a date boundary correctly near midnight UTC", () => {
    // 2026-01-01T02:00:00Z is 2025-12-31 9pm EST (UTC-5 in January) — the
    // previous calendar day in this timezone.
    const instant = new Date("2026-01-01T02:00:00.000Z");
    expect(formatWallClock(instant, "America/Toronto")).toBe("2025-12-31T21:00:00");
  });
});

describe("parseWallClock", () => {
  it("reads a datetime-local value as wall-clock time in the given zone", () => {
    // 2pm in Denver during MDT (UTC-6) is 20:00 UTC.
    expect(parseWallClock("2026-10-06T14:00", "America/Denver")?.toISOString()).toBe("2026-10-06T20:00:00.000Z");
    // The same wall clock in Toronto (EDT, UTC-4) is a different instant.
    expect(parseWallClock("2026-10-06T14:00", "America/Toronto")?.toISOString()).toBe("2026-10-06T18:00:00.000Z");
  });

  it("uses the standard-time offset in winter", () => {
    // MST is UTC-7.
    expect(parseWallClock("2026-12-01T14:30", "America/Denver")?.toISOString()).toBe("2026-12-01T21:30:00.000Z");
  });

  it("round-trips with formatWallClock on both sides of a DST change", () => {
    for (const value of ["2026-03-07T23:30", "2026-03-08T12:00", "2026-10-31T23:00", "2026-11-01T12:00"]) {
      const instant = parseWallClock(value, "America/Denver");
      expect(instant).not.toBeNull();
      expect(formatWallClock(instant as Date, "America/Denver")).toBe(`${value}:00`);
    }
  });

  it("returns a real instant for a wall-clock time skipped by spring-forward", () => {
    // 2:30am on 2026-03-08 doesn't exist in Denver; it must still resolve
    // to a valid instant rather than throw or return null.
    const instant = parseWallClock("2026-03-08T02:30", "America/Denver");
    expect(instant).not.toBeNull();
    expect(Number.isNaN((instant as Date).getTime())).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(parseWallClock("", "America/Denver")).toBeNull();
    expect(parseWallClock("2026-10-06", "America/Denver")).toBeNull();
    expect(parseWallClock("not a date", "America/Denver")).toBeNull();
    expect(parseWallClock("2026-10-06T14:00Z", "America/Denver")).toBeNull();
  });
});

describe("isValidTimeZone", () => {
  it("accepts real IANA zones and rejects anything else", () => {
    expect(isValidTimeZone("America/Denver")).toBe(true);
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Not/A/Zone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
