import type { Job } from "pg-boss";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { processQueuedSystemEmail } from "../../src/lib/transactional/send-system-email";
import type { SendSystemEmailJobData } from "../../src/lib/jobs/enqueue";

/**
 * Processes one queued transactional/system email. All the actual
 * gating/sending logic lives in processQueuedSystemEmail (src/lib/
 * transactional/send-system-email.ts) — this handler is just the pg-boss
 * adapter, same shape as send-scheduled-email.ts's relationship to
 * processDueScheduledEmail. processQueuedSystemEmail itself never throws
 * (it records FAILED on its own row on any provider error) — a throw here
 * would only happen from something outside that contract (e.g. the DB
 * itself being unavailable), which pg-boss's own retry/backoff should
 * still see.
 */
export async function handleSendSystemEmailJob(jobs: Job<SendSystemEmailJobData>[]): Promise<void> {
  const [job] = jobs;
  const { transactionalEmailMessageId } = job.data;

  try {
    await processQueuedSystemEmail(transactionalEmailMessageId);
  } catch (error) {
    logger.error({ err: error, jobId: job.id, transactionalEmailMessageId }, "send-system-email job failed");
    await captureException(error, { jobId: job.id, transactionalEmailMessageId });
    throw error;
  }
}
