// Read-only visibility into pg-boss's own job-state tables, plus retry/
// cancel wrappers around its documented client methods — nothing in this
// codebase read pg-boss's internal `pgboss.job` table before this module
// (confirmed by search). Verified against the installed pg-boss package's
// actual source (node_modules/pg-boss/dist/plans.js) before writing this,
// per this repo's "verify before assuming" convention:
//   - `job.output` on a failed job is `{ message, stack }` — this module
//     only ever selects `output->>'message'`, never the raw `output`
//     column, so a stack trace can never reach an admin page.
//   - `job.data` (the raw enqueue payload, which can contain user-submitted
//     content like search parameters) is never selected here either.
//   - boss.cancel()/boss.retry() are both filtered UPDATEs
//     (`WHERE state < 'completed'` / `WHERE state = 'failed'`) that affect
//     zero rows — never throw — when the target job isn't in a matching
//     state, so both are genuinely idempotent by construction, not just by
//     convention.
//
// No `import "server-only"` and only relative imports — retryJob/cancelJob
// are called from a Next.js Server Action (System Health page), but this
// module also needs to be safely importable wherever job state is queried;
// same reasoning as src/lib/jobs/boss-client.ts's identical omission.
import { prisma } from "../prisma";
import { startBoss } from "./boss-client";

export type QueueStateCounts = {
  queue: string;
  created: number;
  retry: number;
  active: number;
  completed: number;
  cancelled: number;
  failed: number;
};

/**
 * One row per (queue, state) pair from pg-boss's own job table, pivoted
 * into one row per queue. The `job` table is itself partitioned by `name`
 * (one child table per queue) but querying the parent table transparently
 * covers every partition — no per-queue special-casing needed.
 */
export async function getQueueSummary(): Promise<QueueStateCounts[]> {
  try {
    const rows = await prisma.$queryRaw<{ name: string; state: string; count: bigint }[]>`
      SELECT name, state, COUNT(*) as count
      FROM pgboss.job
      GROUP BY name, state
    `;

    const byQueue = new Map<string, QueueStateCounts>();
    for (const row of rows) {
      const entry = byQueue.get(row.name) ?? { queue: row.name, created: 0, retry: 0, active: 0, completed: 0, cancelled: 0, failed: 0 };
      const count = Number(row.count);
      if (row.state in entry) {
        (entry as unknown as Record<string, number>)[row.state] = count;
      }
      byQueue.set(row.name, entry);
    }
    return Array.from(byQueue.values()).sort((a, b) => a.queue.localeCompare(b.queue));
  } catch {
    // pg-boss creates its own `pgboss` schema lazily on first boss.start()
    // — a database where the worker has never run yet (a fresh dev/test DB)
    // simply has no queue data to show, not an error condition. The System
    // Health / Administration pages must render an honest "no data yet"
    // state rather than crash.
    return [];
  }
}

export type FailedJobSummary = {
  id: string;
  queue: string;
  errorMessage: string | null;
  retryCount: number;
  retryLimit: number;
  createdOn: Date;
  completedOn: Date | null;
};

/** Safe job detail for the System Health failed-jobs list — deliberately
 * selects only `output->>'message'`, never the raw `output` (which
 * includes a stack trace) or `data` (the raw enqueue payload) columns. */
export async function getRecentFailedJobs(limit = 25): Promise<FailedJobSummary[]> {
  try {
    const rows = await prisma.$queryRaw<
      { id: string; name: string; error_message: string | null; retry_count: number; retry_limit: number; created_on: Date; completed_on: Date | null }[]
    >`
      SELECT id, name, output->>'message' as error_message, retry_count, retry_limit, created_on, completed_on
      FROM pgboss.job
      WHERE state = 'failed'
      ORDER BY completed_on DESC NULLS LAST
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      queue: row.name,
      errorMessage: row.error_message,
      retryCount: row.retry_count,
      retryLimit: row.retry_limit,
      createdOn: row.created_on,
      completedOn: row.completed_on,
    }));
  } catch {
    return [];
  }
}

export type JobActionResult = { ok: boolean; affected: boolean };

export async function retryJob(queue: string, jobId: string): Promise<JobActionResult> {
  const boss = await startBoss({ supervise: false });
  const before = await getJobState(queue, jobId);
  await boss.retry(queue, jobId);
  const after = await getJobState(queue, jobId);
  return { ok: true, affected: before !== after };
}

export async function cancelJob(queue: string, jobId: string): Promise<JobActionResult> {
  const boss = await startBoss({ supervise: false });
  const before = await getJobState(queue, jobId);
  await boss.cancel(queue, jobId);
  const after = await getJobState(queue, jobId);
  return { ok: true, affected: before !== after };
}

async function getJobState(queue: string, jobId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ state: string }[]>`
    SELECT state FROM pgboss.job WHERE name = ${queue} AND id = ${jobId}::uuid LIMIT 1
  `;
  return rows[0]?.state ?? null;
}
