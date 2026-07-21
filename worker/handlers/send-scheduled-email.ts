import type { Job } from "pg-boss";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { processDueScheduledEmail } from "../../src/lib/comms/send-email";
import type { SendScheduledEmailJobData } from "../../src/lib/jobs/enqueue";

/**
 * Processes one due scheduled email. All the actual gating/sending logic
 * lives in processDueScheduledEmail (src/lib/comms/send-email.ts) — this
 * handler is just the pg-boss adapter, same shape as generate-report.ts's
 * relationship to buildReportRows.
 */
export async function handleSendScheduledEmailJob(jobs: Job<SendScheduledEmailJobData>[]): Promise<void> {
  const [job] = jobs;
  const { emailMessageId } = job.data;

  try {
    const result = await processDueScheduledEmail(emailMessageId);
    if (!result.ok) {
      logger.warn({ emailMessageId }, `send-scheduled-email: ${result.error}`);
    }
  } catch (error) {
    logger.error({ err: error, jobId: job.id, emailMessageId }, "send-scheduled-email job failed");
    await captureException(error, { jobId: job.id, emailMessageId });
    throw error;
  }
}
