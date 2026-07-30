import type { Job } from "pg-boss";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { processDueCampaignStep } from "../../src/lib/campaigns/run-step";
import type { RunCampaignStepJobData } from "../../src/lib/jobs/enqueue";

/**
 * Processes one due campaign step. All the actual stop-condition/execution
 * logic lives in processDueCampaignStep (src/lib/campaigns/run-step.ts) —
 * this handler is just the pg-boss adapter, same shape as
 * run-sequence-step.ts's relationship to processDueSequenceStep.
 */
export async function handleRunCampaignStepJob(jobs: Job<RunCampaignStepJobData>[]): Promise<void> {
  const [job] = jobs;
  const { recipientId, stepId } = job.data;

  try {
    await processDueCampaignStep(recipientId, stepId);
  } catch (error) {
    logger.error({ err: error, jobId: job.id, recipientId, stepId }, "run-campaign-step job failed");
    await captureException(error, { jobId: job.id, recipientId, stepId });
    throw error;
  }
}
