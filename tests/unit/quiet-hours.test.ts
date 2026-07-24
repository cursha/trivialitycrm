import { describe, it, expect } from "vitest";
import { isWithinQuietHours, quietHoursEndInstant } from "../../src/lib/comms/quiet-hours";

// All reference instants below are picked in mid-January so BUSINESS_TIMEZONE
// (America/Toronto) is unambiguously EST (UTC-5, no DST) — instant minus 5h
// = local wall-clock hour.

describe("isWithinQuietHours", () => {
  it("is always false when disabled (null window)", () => {
    expect(isWithinQuietHours(null, new Date("2026-01-15T15:00:00Z"))).toBe(false);
  });

  describe("non-wrapping window (9-17 local)", () => {
    const window = { startHour: 9, endHour: 17 };
    it("is true inside the window (10:00 local)", () => {
      expect(isWithinQuietHours(window, new Date("2026-01-15T15:00:00Z"))).toBe(true);
    });
    it("is false before the window (8:00 local)", () => {
      expect(isWithinQuietHours(window, new Date("2026-01-15T13:00:00Z"))).toBe(false);
    });
    it("is false after the window (18:00 local)", () => {
      expect(isWithinQuietHours(window, new Date("2026-01-15T23:00:00Z"))).toBe(false);
    });
  });

  describe("wrapping window (21-7 local, spans midnight)", () => {
    const window = { startHour: 21, endHour: 7 };
    it("is true in the late-evening portion (22:00 local)", () => {
      expect(isWithinQuietHours(window, new Date("2026-01-16T03:00:00Z"))).toBe(true);
    });
    it("is true in the early-morning portion (3:00 local)", () => {
      expect(isWithinQuietHours(window, new Date("2026-01-15T08:00:00Z"))).toBe(true);
    });
    it("is false at midday (12:00 local)", () => {
      expect(isWithinQuietHours(window, new Date("2026-01-15T17:00:00Z"))).toBe(false);
    });
  });
});

describe("quietHoursEndInstant", () => {
  it("resolves to later today for a non-wrapping window", () => {
    const end = quietHoursEndInstant({ startHour: 9, endHour: 17 }, new Date("2026-01-15T15:00:00Z"));
    expect(end.toISOString()).toBe("2026-01-15T22:00:00.000Z");
  });

  it("resolves to tomorrow morning when currently in the late-evening portion of a wrapping window", () => {
    const end = quietHoursEndInstant({ startHour: 21, endHour: 7 }, new Date("2026-01-16T03:00:00Z"));
    expect(end.toISOString()).toBe("2026-01-16T12:00:00.000Z");
  });

  it("resolves to later today when currently in the early-morning portion of a wrapping window", () => {
    const end = quietHoursEndInstant({ startHour: 21, endHour: 7 }, new Date("2026-01-15T08:00:00Z"));
    expect(end.toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });
});
