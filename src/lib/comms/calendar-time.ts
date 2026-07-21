// No `import "server-only"` — pure date formatting, no I/O, safe from any
// context (and harmless if the worker ever needs it for a future calendar
// sync/reminder job).

/**
 * Formats a real UTC instant as a wall-clock string ("2026-08-01T14:00:00",
 * no offset/Z suffix) in the given IANA timezone — what Microsoft Graph's
 * calendar API requires for event start/end times (its `dateTime` field is
 * documented as "local time, without a time zone offset"; `timeZone` tells
 * Graph how to interpret it). Google's Calendar API is more forgiving and
 * accepts a full RFC3339 instant directly (see google.ts), so this helper
 * is Graph-specific, not shared plumbing both providers need.
 */
export function formatWallClock(instant: Date, timeZone: string): string {
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
  // Intl's h23 cycle reports midnight as "24" in some ICU builds instead of "00".
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}
