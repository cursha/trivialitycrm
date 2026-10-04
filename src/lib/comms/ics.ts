// No `import "server-only"` — pure string building, no I/O; the Titan
// provider (also worker-safe) is its only caller.

/**
 * Builds a single-event iCalendar (RFC 5545) object for an iMIP (RFC 6047)
 * invite email — the standards-based way to put a meeting on someone's
 * calendar when the sending mailbox has no calendar API of its own
 * (Titan). Any mainstream calendar client (Google, Outlook, Apple) offers
 * "add to calendar" for a METHOD:REQUEST message, and removes the event on
 * a matching METHOD:CANCEL.
 *
 * Times are always written in UTC ("…Z") so no VTIMEZONE block is needed —
 * the recipient's client renders them in its own zone. Updates and
 * cancellations must reuse the same UID with a higher SEQUENCE, or clients
 * treat them as a separate event.
 */
export type IcsEventInput = {
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  startAt: Date;
  endAt: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
  organizer: { email: string; name?: string | null };
  attendeeEmails: string[];
  /** Defaults to now — injectable for deterministic tests. */
  dtstamp?: Date;
};

const SEQUENCE_EPOCH_MS = Date.UTC(2020, 0, 1);

/**
 * A SEQUENCE that only ever increases without storing a counter: whole
 * seconds since 2020-01-01. Every update/cancel is sent at a later moment
 * than the invite it supersedes, so this is monotonic per event, and it
 * stays well inside a 32-bit integer (some clients parse SEQUENCE as one)
 * for decades.
 */
export function icsSequence(now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - SEQUENCE_EPOCH_MS) / 1000));
}

function formatUtc(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 §3.3.11 TEXT escaping. CR is dropped outright (only LF is a
 * meaningful line break here) so a stray CRLF from a textarea can't inject
 * a new property line. */
function escapeText(value: string): string {
  return value.replace(/\r/g, "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** A parameter value (e.g. CN) is quoted; DQUOTE and control characters
 * are not allowed inside a quoted parameter at all, so they're removed. */
function quoteParam(value: string): string {
  return `"${value.replace(/["\r\n\t]/g, "").replace(/[\u0000-\u001f]/g, "")}"`;
}

/** An address goes into a mailto: URI value — strip anything that could
 * end the property line or the URI. Callers have already validated these
 * as email addresses; this is defense in depth. */
function mailto(address: string): string {
  return `mailto:${address.replace(/[\s;:,"<>]/g, "")}`;
}

/** RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + a
 * single space. Folds on UTF-8 byte length without ever splitting a
 * multi-byte character. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = "";
      currentBytes = 0;
      // Continuation lines start with the folding space, which counts
      // toward that line's 75 octets.
      limit = 74;
    }
    current += char;
    currentBytes += charBytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcsEvent(input: IcsEventInput): string {
  const organizerParams = input.organizer.name ? `;CN=${quoteParam(input.organizer.name)}` : "";
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Triviality CRM//Appointments//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid.replace(/[\r\n]/g, "")}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${formatUtc(input.dtstamp ?? new Date())}`,
    `DTSTART:${formatUtc(input.startAt)}`,
    `DTEND:${formatUtc(input.endAt)}`,
    `SUMMARY:${escapeText(input.summary)}`,
    ...(input.location ? [`LOCATION:${escapeText(input.location)}`] : []),
    ...(input.description ? [`DESCRIPTION:${escapeText(input.description)}`] : []),
    `ORGANIZER${organizerParams}:${mailto(input.organizer.email)}`,
    ...input.attendeeEmails.map((email) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:${mailto(email)}`),
    `STATUS:${input.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
