// Shared worker-heartbeat-staleness logic — used by both the System Health
// display (src/app/(dashboard)/administration/system-health/queries.ts) and
// the worker-heartbeat-alert tick (worker/handlers/worker-heartbeat-alert-tick.ts),
// so the two never drift on what "stale" means.

/** 3x the 2-minute heartbeat tick interval (worker/handlers/worker-heartbeat-tick.ts)
 * — long enough that a single missed tick under normal jitter never counts
 * as stale, short enough that "stale" reliably means "not running." */
export const HEARTBEAT_FRESHNESS_MS = 3 * 2 * 60 * 1000;

export function isHeartbeatStale(heartbeatUpdatedAt: Date, now: Date): boolean {
  return now.getTime() - heartbeatUpdatedAt.getTime() > HEARTBEAT_FRESHNESS_MS;
}

export type HeartbeatAlertAction = "SEND_ALERT" | "CLEAR_ALERT" | "NONE";

/**
 * Decides what the alert tick should do this run, given the heartbeat's
 * last tick time and whether an alert was already sent for the current
 * stale episode. SEND_ALERT fires at most once per continuous stale
 * episode; CLEAR_ALERT resets that once the worker recovers, so the next
 * separate stale episode alerts again instead of staying silenced forever.
 */
export function decideHeartbeatAlertAction(
  heartbeat: { updatedAt: Date; staleAlertSentAt: Date | null },
  now: Date,
): HeartbeatAlertAction {
  const stale = isHeartbeatStale(heartbeat.updatedAt, now);
  if (stale && !heartbeat.staleAlertSentAt) return "SEND_ALERT";
  if (!stale && heartbeat.staleAlertSentAt) return "CLEAR_ALERT";
  return "NONE";
}
