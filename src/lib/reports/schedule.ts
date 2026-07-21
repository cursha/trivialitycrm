// No `import "server-only"` — the worker (generate-report.ts, reports-tick.ts)
// needs this module too; see src/lib/prisma.ts for the same reasoning.
import { zonedDayRange, zonedWeekRange, zonedMonthRange } from "@/lib/timezone";
import type { ReportDateRangeKey } from "@/lib/reports/date-range-keys";

export type ReportCadenceValue = "DAILY" | "WEEKLY" | "MONTHLY";

/** The next occurrence for a cadence, computed from the *previous*
 * scheduled instant (not "now") so a late-processed tick never causes
 * drift — reuses the already-DST-tested zoned*Range boundary functions
 * rather than hand-rolled date arithmetic, since "add 24 hours" is wrong
 * across a DST transition and "add 1 month" is wrong with naive
 * getMonth()+1 arithmetic near month-end. */
export function computeNextRunAt(cadence: ReportCadenceValue, from: Date): Date {
  if (cadence === "DAILY") return zonedDayRange(from).end;
  if (cadence === "WEEKLY") return zonedWeekRange(from).end;
  return zonedMonthRange(from).end;
}

/** Which date-range key a cadence's generated report should cover — a
 * daily schedule reports on "today," not whatever range was last saved in
 * its linked SavedView. */
export function dateRangeKeyForCadence(cadence: ReportCadenceValue): ReportDateRangeKey {
  if (cadence === "DAILY") return "today";
  if (cadence === "WEEKLY") return "week";
  return "month";
}
