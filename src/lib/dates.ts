// No `import "server-only"` — the worker (via src/app/(dashboard)/reports/queries.ts)
// needs this module too; see src/lib/prisma.ts for the same reasoning.

/**
 * Local-time day boundaries, computed from calendar components (not UTC
 * truncation or a date library) — the convention already established
 * independently in three places (companies/queries.ts's followUpWhere,
 * follow-ups/queries.ts's dayBounds, dashboard/queries.ts) before being
 * consolidated here.
 */
export function dayBounds(reference: Date = new Date()) {
  const startOfToday = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  return { startOfToday, startOfTomorrow };
}

/** The instant `days` calendar days before the start of today — used for
 * "older than N days" threshold comparisons (no-recent-activity,
 * newly-assigned windows). */
export function daysAgo(days: number, reference: Date = new Date()): Date {
  const { startOfToday } = dayBounds(reference);
  return new Date(startOfToday.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Formats a Date as the value a `<input type="datetime-local">` expects
 * (`YYYY-MM-DDTHH:mm`), from local calendar/clock components — not
 * `toISOString()`, which is UTC and would show the wrong time to anyone
 * outside UTC.
 */
export function toDateTimeInputValue(reference: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = reference.getFullYear();
  const month = pad(reference.getMonth() + 1);
  const day = pad(reference.getDate());
  const hours = pad(reference.getHours());
  const minutes = pad(reference.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
