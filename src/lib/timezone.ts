import "server-only";
import { REPORT_DATE_RANGE_KEYS, type ReportDateRangeKey } from "@/lib/reports/date-range-keys";

export { REPORT_DATE_RANGE_KEYS, type ReportDateRangeKey };

/**
 * Single source of truth for the business timezone every report's day/week/
 * month/quarter/year boundary is computed against. Changing the business
 * timezone later (per the Module Five brief: "design the setting so it can
 * be changed safely later") is a one-line change here — no report query
 * hardcodes a timezone or an offset.
 */
export const BUSINESS_TIMEZONE = "America/Toronto";

/** Business weeks start Monday — the common sales-reporting convention.
 * Documented here (and in REPORT_DEFINITIONS.md) since ISO and US calendar
 * conventions disagree and nothing else in the codebase asserts a week
 * start. */
const WEEK_START_DAY = 1; // 0 = Sunday, 1 = Monday, per Date#getDay()

type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl's h23 cycle reports midnight as "24" in some ICU builds instead
    // of "00" — normalize so downstream arithmetic never sees hour 24.
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** How far `timeZone`'s wall clock is from UTC at `instant`, in ms
 * (negative west of UTC, e.g. Toronto in summer is -14400000 / -4h). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

/** The real UTC instant at which `timeZone`'s wall clock reads exactly
 * Y-M-D 00:00:00. Two-pass so a boundary that happens to fall on a DST
 * transition day still resolves against the correct side's offset. */
function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const estimate = guess - offsetMs(new Date(guess), timeZone);
  const refinedOffset = offsetMs(new Date(estimate), timeZone);
  return new Date(guess - refinedOffset);
}

/** The Y/M/D (in `timeZone`) that `instant` falls on. */
export function zonedCalendarDate(instant: Date, timeZone: string = BUSINESS_TIMEZONE) {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

export type DateRange = { start: Date; end: Date };

/** [start, end) UTC instants for the calendar day (in `timeZone`) that
 * `reference` falls on. */
export function zonedDayRange(reference: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): DateRange {
  const { year, month, day } = zonedCalendarDate(reference, timeZone);
  const start = zonedMidnightUtc(year, month, day, timeZone);
  const end = zonedMidnightUtc(year, month, day + 1, timeZone);
  return { start, end };
}

/** [start, end) for the Monday-start business week containing `reference`. */
export function zonedWeekRange(reference: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): DateRange {
  const { year, month, day } = zonedCalendarDate(reference, timeZone);
  // Anchor on the local midnight UTC instant so getUTCDay() reads the
  // correct local weekday regardless of server timezone.
  const anchor = zonedMidnightUtc(year, month, day, timeZone);
  const weekday = anchor.getUTCDay();
  const daysSinceWeekStart = (weekday - WEEK_START_DAY + 7) % 7;
  const start = zonedMidnightUtc(year, month, day - daysSinceWeekStart, timeZone);
  const end = zonedMidnightUtc(year, month, day - daysSinceWeekStart + 7, timeZone);
  return { start, end };
}

/** [start, end) for the calendar month containing `reference`. */
export function zonedMonthRange(reference: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): DateRange {
  const { year, month } = zonedCalendarDate(reference, timeZone);
  const start = zonedMidnightUtc(year, month, 1, timeZone);
  const end = zonedMidnightUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1, timeZone);
  return { start, end };
}

/** [start, end) for the calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep,
 * Oct-Dec) containing `reference`. */
export function zonedQuarterRange(reference: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): DateRange {
  const { year, month } = zonedCalendarDate(reference, timeZone);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const start = zonedMidnightUtc(year, quarterStartMonth, 1, timeZone);
  const nextQuarterMonth = quarterStartMonth + 3;
  const end =
    nextQuarterMonth > 12
      ? zonedMidnightUtc(year + 1, nextQuarterMonth - 12, 1, timeZone)
      : zonedMidnightUtc(year, nextQuarterMonth, 1, timeZone);
  return { start, end };
}

/** [start, end) for the calendar year containing `reference`. */
export function zonedYearRange(reference: Date = new Date(), timeZone: string = BUSINESS_TIMEZONE): DateRange {
  const { year } = zonedCalendarDate(reference, timeZone);
  const start = zonedMidnightUtc(year, 1, 1, timeZone);
  const end = zonedMidnightUtc(year + 1, 1, 1, timeZone);
  return { start, end };
}

/**
 * Resolves one of the brief's six date-range options into a concrete
 * [start, end) instant pair. `custom` must be pre-validated (end > start)
 * by the caller — this function does not clamp or invent a range for an
 * invalid custom input.
 */
export function resolveReportDateRange(
  key: ReportDateRangeKey,
  custom?: DateRange,
  reference: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE,
): DateRange {
  switch (key) {
    case "today":
      return zonedDayRange(reference, timeZone);
    case "week":
      return zonedWeekRange(reference, timeZone);
    case "month":
      return zonedMonthRange(reference, timeZone);
    case "quarter":
      return zonedQuarterRange(reference, timeZone);
    case "year":
      return zonedYearRange(reference, timeZone);
    case "custom":
      if (!custom || !(custom.end.getTime() > custom.start.getTime())) {
        throw new Error("resolveReportDateRange: custom range requires end > start.");
      }
      return custom;
  }
}
