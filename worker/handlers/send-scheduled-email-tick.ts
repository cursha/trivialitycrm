import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { enqueueSendScheduledEmailJob } from "../../src/lib/jobs/enqueue";

/**
 * Runs every 5 minutes (see worker/main.ts) — a shorter interval than
 * reports-tick's hourly cadence, since "send this at 2pm" has a real,
 * user-visible expectation of timeliness that report generation doesn't.
 * Finds every EmailMessage still SCHEDULED whose scheduledFor has passed
 * and enqueues one durable send job per row. Duplicate enqueues across
 * overlapping ticks are harmless: pg-boss's singleton policy (keyed on the
 * message id) silently no-ops a repeat send for a still-unprocessed row.
 */
export async function runSendScheduledEmailTick(): Promise<number> {
  const due = await prisma.emailMessage.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    select: { id: true },
  });

  let enqueued = 0;
  for (const row of due) {
    const jobId = await enqueueSendScheduledEmailJob(row.id);
    if (jobId) enqueued += 1;
  }

  if (due.length > 0) {
    logger.info(`send-scheduled-email-tick: ${due.length} due, ${enqueued} newly enqueued.`);
  }
  return enqueued;
}
