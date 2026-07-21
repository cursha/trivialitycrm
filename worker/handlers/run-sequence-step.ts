import type { Job } from "pg-boss";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { processDueSequenceStep } from "../../src/lib/comms/sequences";
import type { RunSequenceStepJobData } from "../../src/lib/jobs/enqueue";

/**
 * Processes one due sequence step. All the actual stop-condition/execution
 * logic lives in processDueSequenceStep (src/lib/comms/sequences.ts) —
 * this handler is just the pg-boss adapter, same shape as
 * generate-report.ts's relationship to buildReportRows.
 */
export async function handleRunSequenceStepJob(jobs: Job<RunSequenceStepJobData>[]): Promise<void> {
  const [job] = jobs;
  const { enrollmentId, stepId } = job.data;

  try {
    await processDueSequenceStep(enrollmentId, stepId);
  } catch (error) {
    logger.error({ err: error, jobId: job.id, enrollmentId, stepId }, "run-sequence-step job failed");
    await captureException(error, { jobId: job.id, enrollmentId, stepId });
    throw error;
  }
}
