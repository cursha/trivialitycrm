// No `import "server-only"` and only relative imports — loaded by both the
// Next.js web process (as a job producer) and worker/index.ts under plain
// tsx (as the consumer). See src/lib/prisma.ts for the same pattern.
import { PgBoss } from "pg-boss";
import { getEnv } from "../env";

export const QUEUE_RUN_SEARCH = "run-search";
export const QUEUE_GENERATE_REPORT = "generate-report";
export const QUEUE_SEND_SCHEDULED_EMAIL = "send-scheduled-email";
export const QUEUE_RUN_SEQUENCE_STEP = "run-sequence-step";
export const QUEUE_PROCESS_INBOUND_NOTIFICATION = "process-inbound-notification";
export const QUEUE_DATA_QUALITY_SCAN = "data-quality-scan";
export const QUEUE_SEND_SYSTEM_EMAIL = "send-system-email";

/**
 * Retry/expiry defaults for the run-search queue. expireInSeconds is
 * generous (a large multi-candidate search can legitimately run for many
 * minutes) — safe to be generous because run-search.ts checkpoints its
 * progress per candidate, so a job pg-boss expires and retries resumes
 * exactly where it left off *once discovery has already succeeded and
 * candidates exist*. policy: "singleton" + a per-send singletonKey (the
 * LeadSearch id) means at most one ACTIVE job can exist per search at a
 * time — defense in depth against a double-submit, on top of the app-level
 * guard in the start-search action.
 *
 * retryLimit was 3 — confirmed live to be a real cost problem, not just a
 * theoretical one: every discover() failure this module saw happened before
 * any candidate was ever persisted, meaning "resume where it left off"
 * didn't apply — each retry reran the full paid discovery call (up to 16
 * real web_search/web_fetch tool calls) from scratch. A retry only pays off
 * when the failure was transient (network blip) or happened after discovery
 * already succeeded (a genuinely resumable per-candidate failure); it makes
 * a slow/failing discovery call up to 4x as expensive for the same outcome.
 * 1 retry caps the worst case at 2x instead of 4x while still covering a
 * genuine one-off blip.
 */
const RUN_SEARCH_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  retryLimit: 1,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 3600,
  retentionSeconds: 30 * 24 * 60 * 60,
};

/**
 * Same singleton+singletonKey dedup idiom as run-search, applied per
 * (scheduledReportId, nextRunAt) instead of per search — the reports-tick
 * handler sends with singletonKey = `${scheduledReportId}:${nextRunAt.toISOString()}`,
 * so if a tick's own job for that exact period is still active when the
 * next hourly tick runs (slow query, worker restart, etc.), the duplicate
 * send is a no-op rather than a second generation of the same period. Once
 * the handler advances nextRunAt to the next period, the key changes and a
 * new job is free to be sent.
 */
const GENERATE_REPORT_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  retryLimit: 2,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 300,
  retentionSeconds: 30 * 24 * 60 * 60,
};

/**
 * Same singleton+singletonKey dedup idiom, keyed per EmailMessage id — a
 * scheduled email offered by two overlapping ticks (worker restart, slow
 * processing) can only ever have one active job, so it's sent exactly once.
 */
const SEND_SCHEDULED_EMAIL_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  retryLimit: 2,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 120,
  retentionSeconds: 30 * 24 * 60 * 60,
};

/**
 * Keyed per (enrollmentId, stepId) — the same pair SequenceStepRun's
 * `@@unique([enrollmentId, stepId])` constraint dedups at the database
 * level, so a step can be offered by multiple ticks without ever running
 * twice even under a race between two overlapping job attempts.
 */
const RUN_SEQUENCE_STEP_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  retryLimit: 2,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 120,
  retentionSeconds: 30 * 24 * 60 * 60,
};

/**
 * Keyed per notification eventId (see ParsedInboundNotification) — the
 * same id WebhookEvent's own unique constraint dedups at the database
 * level, so this is defense in depth against the webhook route enqueuing
 * a duplicate before its own WebhookEvent insert had a chance to reject
 * one, not the only guard.
 */
const PROCESS_INBOUND_NOTIFICATION_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  retryLimit: 3,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 120,
  retentionSeconds: 30 * 24 * 60 * 60,
};

/**
 * Same singleton+singletonKey dedup idiom as run-search, keyed per scan id
 * (see enqueueDataQualityScanJob) — at most one active job per scan row.
 * expireInSeconds is generous like run-search's (a full scan over many
 * companies/contacts can legitimately run for minutes), safe because the
 * per-record issue-evaluation phase is cursor-checkpointed (see
 * src/lib/data-quality/scan.ts) — a retried job resumes rather than
 * restarting, and the duplicate-detection phase's writes are all
 * idempotent upserts either way.
 */
const DATA_QUALITY_SCAN_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  retryLimit: 2,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 3600,
  retentionSeconds: 30 * 24 * 60 * 60,
};

/**
 * Same singleton+singletonKey dedup idiom as SEND_SCHEDULED_EMAIL_QUEUE_
 * OPTIONS, keyed per TransactionalEmailMessage id — sendSystemEmail()'s own
 * idempotencyKey-unique row means a duplicate enqueue for an
 * already-QUEUED-or-later message is caught before this even matters, but
 * this is defense in depth on the queue side too. A short expiry — a
 * transactional send is one provider HTTP call, never a long-running job.
 */
const SEND_SYSTEM_EMAIL_QUEUE_OPTIONS = {
  policy: "singleton" as const,
  retryLimit: 2,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 60,
  retentionSeconds: 30 * 24 * 60 * 60,
};

let instance: PgBoss | null = null;

/**
 * One PgBoss instance per process, lazily created and memoized. `supervise`
 * should be false for the web process — a pure job producer that may run as
 * multiple instances — so pg-boss's maintenance/stats loop only runs once,
 * in the worker (the sole consumer, and the right place for that loop to
 * own queue supervision). Leave it at the default (true) there.
 */
export function getBoss(options: { supervise?: boolean } = {}): PgBoss {
  if (instance) return instance;
  const env = getEnv();
  instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    supervise: options.supervise ?? true,
  });
  return instance;
}

/**
 * Starts the shared PgBoss instance and ensures every queue this app uses
 * exists. Safe to call from multiple processes concurrently — pg-boss's own
 * schema migration (run by start()) and createQueue() are both idempotent
 * by design (see pg-boss's README: `await boss.createQueue(queue)` is the
 * documented pattern to call unconditionally at startup).
 */
export async function startBoss(options: { supervise?: boolean } = {}): Promise<PgBoss> {
  const boss = getBoss(options);
  await boss.start();
  await boss.createQueue(QUEUE_RUN_SEARCH, RUN_SEARCH_QUEUE_OPTIONS);
  await boss.createQueue(QUEUE_GENERATE_REPORT, GENERATE_REPORT_QUEUE_OPTIONS);
  await boss.createQueue(QUEUE_SEND_SCHEDULED_EMAIL, SEND_SCHEDULED_EMAIL_QUEUE_OPTIONS);
  await boss.createQueue(QUEUE_RUN_SEQUENCE_STEP, RUN_SEQUENCE_STEP_QUEUE_OPTIONS);
  await boss.createQueue(QUEUE_PROCESS_INBOUND_NOTIFICATION, PROCESS_INBOUND_NOTIFICATION_QUEUE_OPTIONS);
  await boss.createQueue(QUEUE_DATA_QUALITY_SCAN, DATA_QUALITY_SCAN_QUEUE_OPTIONS);
  await boss.createQueue(QUEUE_SEND_SYSTEM_EMAIL, SEND_SYSTEM_EMAIL_QUEUE_OPTIONS);
  return boss;
}

/** Test-only: drops the memoized instance so a test can construct a fresh one. */
export function resetBossForTests(): void {
  instance = null;
}
