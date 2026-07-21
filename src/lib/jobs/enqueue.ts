// Deliberately no `import "server-only"` here — worker/handlers/reports-tick.ts
// (running under plain tsx, not Next's "react-server" bundler condition) needs
// enqueueGenerateReportJob too, and that guard throws under plain Node/tsx
// execution. Every consumer of this module is itself a server-only context
// (Server Actions in the web process, or the worker process), same reasoning
// as src/lib/prisma.ts's identical omission.
import { startBoss, QUEUE_RUN_SEARCH, QUEUE_GENERATE_REPORT, QUEUE_SEND_SCHEDULED_EMAIL, QUEUE_RUN_SEQUENCE_STEP } from "./boss-client";

export type RunSearchJobData = { searchId: string };
export type GenerateReportJobData = { scheduledReportId: string; periodKey: string };
export type SendScheduledEmailJobData = { emailMessageId: string };
export type RunSequenceStepJobData = { enrollmentId: string; stepId: string };

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

/**
 * Enqueues a durable report-generation job. `periodKey` is the schedule's
 * `nextRunAt` at enqueue time (an ISO string), combined with the schedule
 * id into the singletonKey — see GENERATE_REPORT_QUEUE_OPTIONS in
 * boss-client.ts for why. Returns null (rather than throwing) when pg-boss
 * declines the send because an identical-key job is already active — that
 * is the dedup working as intended, not a failure the caller should retry.
 */
export async function enqueueGenerateReportJob(scheduledReportId: string, periodKey: string): Promise<string | null> {
  const boss = await startBoss({ supervise: false });
  return boss.send(
    QUEUE_GENERATE_REPORT,
    { scheduledReportId, periodKey } satisfies GenerateReportJobData,
    { singletonKey: `${scheduledReportId}:${periodKey}` },
  );
}

/** Enqueues the actual send for one due scheduled EmailMessage.
 * singletonKey = the message id, so an overlapping tick's duplicate send
 * for the same still-unprocessed row is a no-op. */
export async function enqueueSendScheduledEmailJob(emailMessageId: string): Promise<string | null> {
  const boss = await startBoss({ supervise: false });
  return boss.send(
    QUEUE_SEND_SCHEDULED_EMAIL,
    { emailMessageId } satisfies SendScheduledEmailJobData,
    { singletonKey: emailMessageId },
  );
}

/** Enqueues one sequence step's execution. singletonKey = enrollmentId:stepId
 * — the same pair SequenceStepRun's own unique constraint dedups at the DB
 * level, so this is defense in depth, not the only guard. */
export async function enqueueRunSequenceStepJob(enrollmentId: string, stepId: string): Promise<string | null> {
  const boss = await startBoss({ supervise: false });
  return boss.send(
    QUEUE_RUN_SEQUENCE_STEP,
    { enrollmentId, stepId } satisfies RunSequenceStepJobData,
    { singletonKey: `${enrollmentId}:${stepId}` },
  );
}
