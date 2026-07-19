import type { PgBoss } from "pg-boss";
import { logger } from "../src/lib/logger";

/**
 * Drains in-flight pg-boss job handlers before the process exits. `boss.stop`
 * with `graceful: true` waits (up to `timeoutMs`) for active work() handlers
 * to finish on their own — our run-search handler checks LeadSearch.status
 * for cancellation between candidates but otherwise runs to completion of
 * its current step, so this window lets one in-flight provider call finish
 * and checkpoint rather than being torn down mid-write. If the graceful
 * window elapses, pg-boss aborts each job's signal and stop() resolves
 * regardless; the hard timeout below is a final backstop in case stop()
 * itself hangs, so Railway's own SIGKILL grace period is never the thing
 * that decides when we exit.
 */
export async function shutdownBoss(boss: PgBoss, options: { timeoutMs?: number; hardTimeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 25_000;
  const hardTimeoutMs = options.hardTimeoutMs ?? timeoutMs + 5_000;

  const hardTimeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.error(`graceful shutdown exceeded ${hardTimeoutMs}ms — forcing exit.`);
      resolve();
    }, hardTimeoutMs).unref();
  });

  await Promise.race([boss.stop({ graceful: true, timeout: timeoutMs }), hardTimeout]);
}
