import { describe, it, expect } from "vitest";
import { computeNextRunAt, dateRangeKeyForCadence } from "../../src/lib/reports/schedule";

describe("computeNextRunAt", () => {
  it("DAILY advances to the start of the next business day", () => {
    // Noon Toronto (EDT, UTC-4) on July 20.
    const from = new Date("2026-07-20T16:00:00Z");
    const next = computeNextRunAt("DAILY", from);
    expect(next.toISOString()).toBe("2026-07-21T04:00:00.000Z");
  });

  it("WEEKLY advances to the start of the next Monday", () => {
    const from = new Date("2026-07-20T16:00:00Z"); // Monday
    const next = computeNextRunAt("WEEKLY", from);
    expect(next.toISOString()).toBe("2026-07-27T04:00:00.000Z");
  });

  it("MONTHLY advances to the start of the next calendar month", () => {
    const from = new Date("2026-07-20T16:00:00Z");
    const next = computeNextRunAt("MONTHLY", from);
    expect(next.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("DAILY is DST-correct across the fall-back transition", () => {
    // November 1, 2026 is the DST fall-back date for America/Toronto — the
    // clock change itself happens at 2am local that day, so midnight Nov 1
    // is still EDT (UTC-4); EST doesn't start until later that same day.
    const from = new Date("2026-10-31T15:00:00Z"); // Oct 31, EDT
    const next = computeNextRunAt("DAILY", from);
    expect(next.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });
});

describe("dateRangeKeyForCadence", () => {
  it("maps each cadence to its matching date-range key", () => {
    expect(dateRangeKeyForCadence("DAILY")).toBe("today");
    expect(dateRangeKeyForCadence("WEEKLY")).toBe("week");
    expect(dateRangeKeyForCadence("MONTHLY")).toBe("month");
  });
});
