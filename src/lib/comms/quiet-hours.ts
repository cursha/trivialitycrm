// Module Nine: one business-wide quiet-hours window (WorkspaceSettings.
// quietHoursStartHour/EndHour, BUSINESS_TIMEZONE-relative — reusing the
// same single-timezone simplification Module Five/8A already established
// for report/budget day boundaries, not per-user/per-territory). Applies
// only to CRM-outreach email (prepareSend/processDueScheduledEmail/sequence
// steps in send-email.ts and sequences.ts) — transactional/system email
// (password reset, admin test-send) is exempt as account/transactional
// mail, not marketing/outreach.
//
// No `import "server-only"` — the worker's scheduled-send and
// run-sequence-step handlers need this too; same reasoning as every other
// module in this tree (see src/lib/prisma.ts).
import { prisma } from "../prisma";
import { zonedDayRange, zonedHour } from "../timezone";

export type QuietHoursWindow = { startHour: number; endHour: number } | null;

/** Null (disabled) when either field is unset, or when they're equal (a
 * degenerate zero-width window is treated as "no restriction" rather than
 * "block everything, always"). */
export async function getQuietHoursWindow(): Promise<QuietHoursWindow> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { id: 1 },
    select: { quietHoursStartHour: true, quietHoursEndHour: true },
  });
  if (!settings || settings.quietHoursStartHour === null || settings.quietHoursEndHour === null) return null;
  if (settings.quietHoursStartHour === settings.quietHoursEndHour) return null;
  return { startHour: settings.quietHoursStartHour, endHour: settings.quietHoursEndHour };
}

/** Handles a window that wraps midnight (e.g. 21-7) as well as one that
 * doesn't (e.g. 9-17). */
export function isWithinQuietHours(window: QuietHoursWindow, reference: Date = new Date()): boolean {
  if (!window) return false;
  const hour = zonedHour(reference);
  return window.startHour < window.endHour ? hour >= window.startHour && hour < window.endHour : hour >= window.startHour || hour < window.endHour;
}

/**
 * The next real UTC instant quiet hours end, given `reference` currently
 * falls inside `window` — used to reschedule a deferred scheduled send.
 * Built from zonedDayRange's own DST-safe local-midnight instants plus a
 * fixed-hour offset (safe UTC-millisecond arithmetic from that point on),
 * matching the rigor src/lib/timezone.ts already applies elsewhere.
 */
export function quietHoursEndInstant(window: NonNullable<QuietHoursWindow>, reference: Date = new Date()): Date {
  const hour = zonedHour(reference);
  const { start: todayMidnightUtc, end: tomorrowMidnightUtc } = zonedDayRange(reference);
  const msPerHour = 60 * 60 * 1000;

  if (window.startHour < window.endHour) {
    return new Date(todayMidnightUtc.getTime() + window.endHour * msPerHour);
  }
  // Wrapping window (e.g. 21-7): currently in the late-evening portion
  // (hour >= startHour) means the window ends tomorrow morning; currently
  // in the early-morning portion (hour < endHour, already past local
  // midnight) means it ends later today.
  return hour >= window.startHour
    ? new Date(tomorrowMidnightUtc.getTime() + window.endHour * msPerHour)
    : new Date(todayMidnightUtc.getTime() + window.endHour * msPerHour);
}
