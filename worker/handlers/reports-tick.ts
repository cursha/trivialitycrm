import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { enqueueGenerateReportJob } from "../../src/lib/jobs/enqueue";

/**
 * Runs hourly (see worker/main.ts). Finds every active ScheduledReport whose
 * nextRunAt has passed and enqueues one durable generate-report job per row.
 * Does NOT advance nextRunAt itself — that happens only after the
 * generate-report handler actually succeeds or permanently fails (see that
 * handler) — so a row stays "due" and gets re-offered every tick until it's
 * actually processed. Duplicate enqueues across ticks are harmless: pg-boss's
 * singleton policy on QUEUE_GENERATE_REPORT (keyed on scheduledReportId +
 * the row's current nextRunAt) silently no-ops a repeat send for the same
 * still-unprocessed period.
 */
export async function runReportsTick(): Promise<number> {
  const due = await prisma.scheduledReport.findMany({
    where: { active: true, nextRunAt: { lte: new Date() } },
    select: { id: true, nextRunAt: true },
  });

  let enqueued = 0;
  for (const row of due) {
    const jobId = await enqueueGenerateReportJob(row.id, row.nextRunAt.toISOString());
    if (jobId) enqueued += 1;
  }

  if (due.length > 0) {
    logger.info(`reports-tick: ${due.length} due, ${enqueued} newly enqueued.`);
  }
  return enqueued;
}
