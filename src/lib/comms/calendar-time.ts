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

/** A plain string can't be trusted as a real IANA zone name until
 * Intl actually accepts it — an invalid zone throws a RangeError we'd
 * otherwise let escape as an unhandled exception deep inside the provider
 * call instead of a clear, immediate form error. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The inverse of formatWallClock: interprets a browser `datetime-local`
 * value ("2026-10-06T14:30", no offset) as wall-clock time in the given
 * IANA timezone and returns the real UTC instant. `new Date(value)` alone
 * would silently interpret it in the *server's* zone (UTC on Railway), so a
 * 2pm Denver demo would land at 2pm UTC. Returns null for an unparseable
 * value.
 *
 * Works by guessing the instant as if the wall clock were UTC, measuring
 * how far the zone's wall clock is from that guess, and correcting — done
 * twice so a guess that lands on the other side of a DST transition still
 * converges. A wall-clock time skipped by a spring-forward gap resolves to
 * the equivalent instant just after the gap.
 */
export function parseWallClock(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? "0"));
  if (Number.isNaN(asUtc)) return null;

  let instant = asUtc;
  for (let i = 0; i < 2; i++) {
    const wall = formatWallClock(new Date(instant), timeZone);
    const wallAsUtc = Date.parse(`${wall}Z`);
    instant += asUtc - wallAsUtc;
  }
  return new Date(instant);
}
