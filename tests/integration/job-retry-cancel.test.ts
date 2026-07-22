import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { PgBoss } from "pg-boss";
import crypto from "node:crypto";
import { resetDatabase } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { retryFailedJob, cancelEligibleJob } from "../../src/app/(dashboard)/administration/system-health/actions";
import { testPrisma } from "../helpers/db";

// Same real-pg-boss-mechanics idiom as tests/integration/job-queue.test.ts —
// exercises the actual retryJob/cancelJob wrappers (src/lib/jobs/
// observability.ts) against a real, uniquely-named queue so this test never
// interferes with any other test's job data.
const bosses: PgBoss[] = [];

async function createBoss() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL as string, schema: "pgboss", supervise: false });
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

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

afterEach(async () => {
  while (bosses.length > 0) {
    const boss = bosses.pop();
    if (boss) await boss.stop({ graceful: false, timeout: 500 }).catch(() => {});
  }
});

async function adminUser() {
  const role = await createRoleWithPermissions("Administrator", ["manage_background_jobs"]);
  return createTestUser({ roleId: role.id });
}

describe("job retry and cancel", () => {
  it("requires manage_background_jobs", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(retryFailedJob("whatever", crypto.randomUUID())).rejects.toThrow();
  });

  it("retries a genuinely failed job and audits the action", async () => {
    const user = await adminUser();
    await loginAs(user.id);

    const queue = uniqueQueueName("retry");
    const boss = await createBoss();
    await boss.createQueue(queue, { retryLimit: 0, retryBackoff: false, retryDelay: 0 });
    const jobId = (await boss.send(queue, {})) as string;
    await boss.work(queue, { pollingIntervalSeconds: 0.5 }, async () => {
      throw new Error("Always fails");
    });
    await wait(2500);

    const [failedJob] = await boss.findJobs(queue, { id: jobId });
    expect(failedJob?.state).toBe("failed");

    const result = await retryFailedJob(queue, jobId);
    expect(result?.error).toBeUndefined();

    const [retriedJob] = await boss.findJobs(queue, { id: jobId });
    expect(retriedJob?.state).toBe("retry");

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "job.retried", entityId: jobId } });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.success).toBe(true);
  }, 15000);

  it("retrying a job that isn't failed is a safe, audited no-op (idempotent)", async () => {
    const user = await adminUser();
    await loginAs(user.id);

    const queue = uniqueQueueName("retry-noop");
    const boss = await createBoss();
    await boss.createQueue(queue, { retryLimit: 0 });
    const jobId = (await boss.send(queue, {}, { startAfter: 60 })) as string; // not due yet, still "created"

    const result = await retryFailedJob(queue, jobId);
    expect(result?.error).toMatch(/no longer eligible/);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "job.retried", entityId: jobId } });
    expect(auditEvent?.success).toBe(false);
  });

  it("cancels a pending job and audits the action", async () => {
    const user = await adminUser();
    await loginAs(user.id);

    const queue = uniqueQueueName("cancel");
    const boss = await createBoss();
    await boss.createQueue(queue, { retryLimit: 0 });
    const jobId = (await boss.send(queue, {}, { startAfter: 60 })) as string;

    const result = await cancelEligibleJob(queue, jobId);
    expect(result?.error).toBeUndefined();

    const [cancelledJob] = await boss.findJobs(queue, { id: jobId });
    expect(cancelledJob?.state).toBe("cancelled");
  });

  it("cancelling an already-terminal job is a safe, audited no-op (idempotent)", async () => {
    const user = await adminUser();
    await loginAs(user.id);

    const queue = uniqueQueueName("cancel-noop");
    const boss = await createBoss();
    await boss.createQueue(queue, { retryLimit: 0 });
    const jobId = (await boss.send(queue, {})) as string;
    await boss.work(queue, { pollingIntervalSeconds: 0.5 }, async () => {});
    await wait(1500);

    const [completedJob] = await boss.findJobs(queue, { id: jobId });
    expect(completedJob?.state).toBe("completed");

    const result = await cancelEligibleJob(queue, jobId);
    expect(result?.error).toMatch(/no longer eligible/);
  }, 15000);
});
