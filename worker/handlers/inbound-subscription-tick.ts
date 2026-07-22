import { logger } from "../../src/lib/logger";
import { runInboundSubscriptionTick as runTick } from "../../src/lib/comms/inbound-sync";

/**
 * Runs hourly (see worker/main.ts). Unlike reports-tick/send-scheduled-
 * email-tick (which enqueue a job per due row for a *separate* worker to
 * process), this tick does the subscription create/renew work directly —
 * it's already running in the worker process, and a per-connection
 * create/renew call is a single external API round trip, not something
 * that benefits from its own job-level retry semantics the way a send
 * does. All the actual per-connection logic (and per-connection failure
 * isolation) lives in runInboundSubscriptionTick (src/lib/comms/inbound-sync.ts).
 */
export async function runInboundSubscriptionTick(): Promise<void> {
  const { ok, failed } = await runTick();
  if (ok > 0 || failed > 0) {
    logger.info(`inbound-subscription-tick: ${ok} ensured, ${failed} failed.`);
  }
}
