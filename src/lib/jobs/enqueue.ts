import "server-only";
import { startBoss, QUEUE_RUN_SEARCH } from "./boss-client";

export type RunSearchJobData = { searchId: string };

/** Enqueues a durable run-search job and returns pg-boss's job id (stored on
 * LeadSearch.providerJobId for cancellation lookup / log correlation). The
 * web process only ever enqueues — it never executes a job itself. */
export async function enqueueSearchJob(searchId: string): Promise<string> {
  const boss = await startBoss({ supervise: false });
  const jobId = await boss.send(QUEUE_RUN_SEARCH, { searchId } satisfies RunSearchJobData, { singletonKey: searchId });
  if (!jobId) {
    throw new Error(`Failed to enqueue a search job for LeadSearch ${searchId}.`);
  }
  return jobId;
}

/** Prevents a not-yet-started (queued) job from running. Does not abort an
 * already-active job — the cancel action itself sets LeadSearch.status to
 * CANCELLED, which the running handler polls for cooperatively between
 * candidates (see RunSearchJobOptions.isCancelled in run-search.ts). */
export async function cancelSearchJob(providerJobId: string): Promise<void> {
  const boss = await startBoss({ supervise: false });
  await boss.cancel(QUEUE_RUN_SEARCH, providerJobId);
}
