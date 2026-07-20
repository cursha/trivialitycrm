import { describe, it, expect } from "vitest";
import {
  zonedDayRange,
  zonedWeekRange,
  zonedMonthRange,
  zonedQuarterRange,
  zonedYearRange,
  resolveReportDateRange,
  BUSINESS_TIMEZONE,
} from "../../src/lib/timezone";

describe("zonedDayRange", () => {
  it("returns midnight-to-midnight Toronto time as UTC instants (EDT, UTC-4)", () => {
    // Noon Toronto on a July day is 16:00 UTC.
    const reference = new Date("2026-07-20T16:00:00Z");
    const { start, end } = zonedDayRange(reference, BUSINESS_TIMEZONE);
    expect(start.toISOString()).toBe("2026-07-20T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-21T04:00:00.000Z");
  });

  it("returns midnight-to-midnight Toronto time as UTC instants (EST, UTC-5)", () => {
    const reference = new Date("2026-01-20T16:00:00Z");
    const { start, end } = zonedDayRange(reference, BUSINESS_TIMEZONE);
    expect(start.toISOString()).toBe("2026-01-20T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-21T05:00:00.000Z");
  });

  it("resolves the correct Toronto calendar day even when the UTC instant is on the next UTC day", () => {
    // 23:30 Toronto (EDT) on July 20 is 03:30 UTC on July 21.
    const reference = new Date("2026-07-21T03:30:00Z");
    const { start } = zonedDayRange(reference, BUSINESS_TIMEZONE);
    expect(start.toISOString()).toBe("2026-07-20T04:00:00.000Z");
  });
});

describe("zonedWeekRange", () => {
  it("starts on Monday", () => {
    // Wednesday July 22, 2026, noon Toronto.
    const reference = new Date("2026-07-22T16:00:00Z");
    const { start, end } = zonedWeekRange(reference, BUSINESS_TIMEZONE);
    // Monday July 20, 2026 00:00 Toronto = 2026-07-20T04:00:00Z.
    expect(start.toISOString()).toBe("2026-07-20T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-27T04:00:00.000Z");
  });

  it("a Monday reference is its own week start", () => {
    const reference = new Date("2026-07-20T16:00:00Z");
    const { start } = zonedWeekRange(reference, BUSINESS_TIMEZONE);
    expect(start.toISOString()).toBe("2026-07-20T04:00:00.000Z");
  });
});

describe("zonedMonthRange", () => {
  it("spans the full calendar month and rolls over the year at December", () => {
    const reference = new Date("2026-12-15T16:00:00Z");
    const { start, end } = zonedMonthRange(reference, BUSINESS_TIMEZONE);
    expect(start.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("zonedQuarterRange", () => {
  it("computes Q3 (Jul-Sep) for a July reference", () => {
    const reference = new Date("2026-07-20T16:00:00Z");
    const { start, end } = zonedQuarterRange(reference, BUSINESS_TIMEZONE);
    expect(start.toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T04:00:00.000Z");
  });

  it("computes Q4 and rolls over the year", () => {
    const reference = new Date("2026-11-15T16:00:00Z");
    const { start, end } = zonedQuarterRange(reference, BUSINESS_TIMEZONE);
    expect(start.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("zonedYearRange", () => {
  it("spans January 1 through December 31", () => {
    const reference = new Date("2026-06-15T16:00:00Z");
    const { start, end } = zonedYearRange(reference, BUSINESS_TIMEZONE);
    expect(start.toISOString()).toBe("2026-01-01T05:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("resolveReportDateRange", () => {
  it("dispatches each key to its matching range function", () => {
    const reference = new Date("2026-07-20T16:00:00Z");
    expect(resolveReportDateRange("today", undefined, reference)).toEqual(zonedDayRange(reference));
    expect(resolveReportDateRange("week", undefined, reference)).toEqual(zonedWeekRange(reference));
    expect(resolveReportDateRange("month", undefined, reference)).toEqual(zonedMonthRange(reference));
    expect(resolveReportDateRange("quarter", undefined, reference)).toEqual(zonedQuarterRange(reference));
    expect(resolveReportDateRange("year", undefined, reference)).toEqual(zonedYearRange(reference));
  });

  it("returns a valid custom range unchanged", () => {
    const custom = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-02-01T00:00:00Z") };
    expect(resolveReportDateRange("custom", custom)).toEqual(custom);
  });

  it("rejects a custom range with end <= start", () => {
    const bad = { start: new Date("2026-02-01T00:00:00Z"), end: new Date("2026-01-01T00:00:00Z") };
    expect(() => resolveReportDateRange("custom", bad)).toThrow();
  });

  it("rejects a missing custom range", () => {
    expect(() => resolveReportDateRange("custom")).toThrow();
  });
});
