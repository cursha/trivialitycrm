import type { Job } from "pg-boss";
import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { runSearchJob } from "../../src/lib/research/run-search";
import type { RunSearchJobData } from "../../src/lib/jobs/enqueue";

async function isSearchCancelled(searchId: string): Promise<boolean> {
  const search = await prisma.leadSearch.findUnique({ where: { id: searchId }, select: { status: true } });
  return search?.status === "CANCELLED";
}

/**
 * pg-boss work() handler for the run-search queue. Batch size is always 1
 * (the default) — destructure the single job. All LeadSearch.status
 * management (RUNNING/SUCCEEDED/FAILED) happens inside runSearchJob itself,
 * which never throws — it always resolves, recording the outcome in the
 * LeadSearch row either way (this is also what keeps it usable from direct
 * callers, e.g. tests, that expect a plain resolved promise regardless of
 * outcome). This wrapper re-derives failure from that persisted status
 * afterward and throws only here, at the pg-boss integration boundary, so
 * the queue records the retry/failure and applies backoff — without
 * runSearchJob's own contract needing to change for this caller.
 */
export async function handleRunSearchJob(jobs: Job<RunSearchJobData>[]): Promise<void> {
  const [job] = jobs;
  const { searchId } = job.data;

  await runSearchJob(searchId, { isCancelled: () => isSearchCancelled(searchId) });

  const result = await prisma.leadSearch.findUnique({ where: { id: searchId }, select: { status: true, errorMessage: true } });
  if (result?.status === "FAILED") {
    const message = result.errorMessage ?? "Search failed.";
    const error = new Error(message);
    logger.error({ jobId: job.id, searchId }, `run-search job failed: ${message}`);
    await captureException(error, { jobId: job.id, searchId });
    throw error;
  }
}
