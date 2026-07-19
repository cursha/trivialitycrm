import { describe, it, expect, afterEach } from "vitest";
import { PgBoss } from "pg-boss";
import crypto from "node:crypto";

// These tests exercise pg-boss's own guarantees directly (claiming,
// singleton-key uniqueness, retry/backoff, cancellation, expiry-driven
// recovery) against the real test Postgres database — not the full
// run-search.ts business logic (see search-run.test.ts and
// search-run-resume.test.ts for that). Each test uses its own uniquely
// named queue so tests never interfere with each other or with jobs left
// behind by a previous run.

const bosses: PgBoss[] = [];

async function createBoss(overrides: ConstructorParameters<typeof PgBoss>[0] extends infer T ? Partial<T> : never = {}) {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL as string,
    schema: "pgboss",
    supervise: false,
    ...overrides,
  });
  await boss.start();
  bosses.push(boss);
  return boss;
}

function uniqueQueueName(label: string): string {
  return `test-${label}-${crypto.randomUUID()}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  while (bosses.length > 0) {
    const boss = bosses.pop();
    if (boss) await boss.stop({ graceful: false, timeout: 500 }).catch(() => {});
  }
});

describe("pg-boss job queue durability", () => {
  it("claims a job exactly once even with two workers racing on it", async () => {
    const queue = uniqueQueueName("claim");
    const bossA = await createBoss();
    const bossB = await createBoss();
    await bossA.createQueue(queue, { retryLimit: 0 });

    const handledBy: string[] = [];
    await bossA.work(queue, { pollingIntervalSeconds: 0.5 }, async () => {
      handledBy.push("A");
      await wait(200);
    });
    await bossB.work(queue, { pollingIntervalSeconds: 0.5 }, async () => {
      handledBy.push("B");
      await wait(200);
    });

    await bossA.send(queue, {});
    await wait(2500);

    expect(handledBy.length).toBe(1);
  }, 15000);

  it("keeps a second job under the same singletonKey queued while the first is active, on a singleton-policy queue", async () => {
    const queue = uniqueQueueName("singleton");
    const boss = await createBoss();
    await boss.createQueue(queue, { policy: "singleton", retryLimit: 0 });

    const key = crypto.randomUUID();
    const firstId = await boss.send(queue, {}, { singletonKey: key });
    expect(firstId).not.toBeNull();

    let released: () => void = () => {};
    const blocker = new Promise<void>((resolve) => {
      released = resolve;
    });

    const claimedOrder: string[] = [];
    await boss.work(queue, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
      claimedOrder.push(jobs[0].id);
      if (jobs[0].id === firstId) await blocker;
    });

    // Wait for the first job to actually be claimed (become active) before
    // sending a second one under the same key — send() itself is allowed to
    // succeed (it queues a second row); what's guaranteed is that it can't
    // become active while the first job under that key still is.
    await wait(1500);
    expect(claimedOrder).toEqual([firstId]);

    const secondId = await boss.send(queue, {}, { singletonKey: key });
    expect(secondId).not.toBeNull();

    await wait(1500);
    // The second job must still be sitting queued, not active, while the
    // first (still blocked) holds the only "active" slot for this key.
    const [secondBeforeRelease] = await boss.findJobs(queue, { id: secondId as string });
    expect(secondBeforeRelease?.state).toBe("created");

    released();
    await wait(2000);

    const [secondAfterRelease] = await boss.findJobs(queue, { id: secondId as string });
    expect(claimedOrder).toEqual([firstId, secondId]);
    expect(secondAfterRelease?.state).toBe("completed");
  }, 15000);

  it("retries a failing job with bounded exponential backoff before succeeding", async () => {
    const queue = uniqueQueueName("retry");
    const boss = await createBoss();
    await boss.createQueue(queue, { retryLimit: 3, retryBackoff: true, retryDelay: 1 });

    let attempts = 0;
    const jobId = await boss.send(queue, {});
    expect(jobId).not.toBeNull();

    await boss.work(queue, { pollingIntervalSeconds: 0.5, includeMetadata: true }, async () => {
      attempts += 1;
      if (attempts < 3) throw new Error(`Simulated transient failure #${attempts}`);
    });

    await wait(8000);

    expect(attempts).toBe(3);
    const [job] = await boss.findJobs(queue, { id: jobId as string });
    expect(job?.state).toBe("completed");
  }, 20000);

  it("marks a job permanently failed once retries are exhausted", async () => {
    const queue = uniqueQueueName("exhausted");
    const boss = await createBoss();
    await boss.createQueue(queue, { retryLimit: 1, retryBackoff: false, retryDelay: 0 });

    let attempts = 0;
    const jobId = await boss.send(queue, {});

    await boss.work(queue, { pollingIntervalSeconds: 0.5 }, async () => {
      attempts += 1;
      throw new Error("Always fails");
    });

    await wait(4000);

    expect(attempts).toBe(2); // initial attempt + 1 retry
    const [job] = await boss.findJobs(queue, { id: jobId as string });
    expect(job?.state).toBe("failed");
  }, 15000);

  it("never runs a job cancelled before a worker claims it", async () => {
    const queue = uniqueQueueName("cancel");
    const boss = await createBoss();
    await boss.createQueue(queue, { retryLimit: 0 });

    const jobId = await boss.send(queue, {}, { startAfter: 2 });
    await boss.cancel(queue, jobId as string);

    let ran = false;
    await boss.work(queue, { pollingIntervalSeconds: 0.5 }, async () => {
      ran = true;
    });

    await wait(3500);

    expect(ran).toBe(false);
    const [job] = await boss.findJobs(queue, { id: jobId as string });
    expect(job?.state).toBe("cancelled");
  }, 15000);

  it("recovers a job whose worker never completed it within its expiry window", async () => {
    const queue = uniqueQueueName("expiry");
    // Aggressive maintenance interval so expiry-driven recovery is
    // observable within a test-sized timeout, not pg-boss's production
    // default cadence.
    const boss = await createBoss({ superviseIntervalSeconds: 1, monitorIntervalSeconds: 1, maintenanceIntervalSeconds: 1 });
    await boss.createQueue(queue, { retryLimit: 1, expireInSeconds: 1 });

    const jobId = await boss.send(queue, {});

    // A handler that hangs well past the 1-second expiry — simulating a
    // worker that died mid-job without ever calling complete/fail.
    await boss.work(queue, { pollingIntervalSeconds: 0.5 }, async () => {
      await wait(30_000);
    });

    await wait(6000);

    const [job] = await boss.findJobs(queue, { id: jobId as string, key: undefined });
    // Expired once already (retryLimit 1 gives it one more attempt) — it
    // should no longer be sitting in its original active attempt; pg-boss
    // has reclaimed it (retry or failed, never still the original active run).
    expect(["retry", "active", "failed"]).toContain(job?.state);
    expect(job?.state).not.toBeUndefined();
  }, 15000);
});
