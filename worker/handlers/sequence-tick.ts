import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { enqueueRunSequenceStepJob } from "../../src/lib/jobs/enqueue";

/**
 * Runs every 5 minutes (see worker/main.ts). Finds every ACTIVE enrollment
 * whose nextStepDueAt has passed and enqueues one durable run-sequence-step
 * job per row, for the step at its current currentStepOrder. Does NOT
 * advance currentStepOrder itself — that happens only after the step
 * actually runs (see processDueSequenceStep) — so a row stays "due" and
 * gets re-offered every tick until it's actually processed. Duplicate
 * enqueues across ticks are harmless: pg-boss's singleton policy (keyed on
 * enrollmentId:stepId) silently no-ops a repeat send for a still-pending
 * step, and SequenceStepRun's own unique constraint is the final backstop.
 */
export async function runSequenceTick(): Promise<number> {
  const due = await prisma.sequenceEnrollment.findMany({
    where: { status: "ACTIVE", nextStepDueAt: { lte: new Date() } },
    select: { id: true, sequenceId: true, currentStepOrder: true },
  });

  let enqueued = 0;
  for (const enrollment of due) {
    const step = await prisma.sequenceStep.findUnique({
      where: { sequenceId_stepOrder: { sequenceId: enrollment.sequenceId, stepOrder: enrollment.currentStepOrder } },
      select: { id: true },
    });
    if (!step) continue;

    const jobId = await enqueueRunSequenceStepJob(enrollment.id, step.id);
    if (jobId) enqueued += 1;
  }

  if (due.length > 0) {
    logger.info(`sequence-tick: ${due.length} due, ${enqueued} newly enqueued.`);
  }
  return enqueued;
}
