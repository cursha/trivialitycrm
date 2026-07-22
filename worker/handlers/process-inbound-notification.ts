import type { Job } from "pg-boss";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { processInboundNotification } from "../../src/lib/comms/inbound-sync";
import type { ProcessInboundNotificationJobData } from "../../src/lib/jobs/enqueue";

/**
 * Processes one inbound webhook notification: fetches the real message
 * content and writes it (matched or unmatched) via processInboundNotification
 * (src/lib/comms/inbound-sync.ts) — this handler is just the pg-boss
 * adapter, same shape as every other job handler in this directory.
 */
export async function handleProcessInboundNotificationJob(jobs: Job<ProcessInboundNotificationJobData>[]): Promise<void> {
  const [job] = jobs;
  const { connectionId, providerMessageId } = job.data;

  try {
    await processInboundNotification({ connectionId, providerMessageId });
  } catch (error) {
    logger.error({ err: error, jobId: job.id, connectionId }, "process-inbound-notification job failed");
    await captureException(error, { jobId: job.id, connectionId });
    throw error;
  }
}
