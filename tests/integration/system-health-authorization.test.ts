import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { requireUser } from "../../src/lib/auth/current-user";
import { requirePermission } from "../../src/lib/auth/permissions";
import { getSystemHealth } from "../../src/app/(dashboard)/administration/system-health/queries";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("system health", () => {
  it("requires view_system_health to access the underlying page's permission gate", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const currentUser = await requireUser();
    expect(() => requirePermission(currentUser, "view_system_health")).toThrow();
  });

  it("never returns a raw job payload or stack trace — only a safe summary", async () => {
    const health = await getSystemHealth();

    // These fields simply must not exist anywhere on the returned shape —
    // asserting their absence directly, not just "didn't crash."
    expect(health).not.toHaveProperty("data");
    expect(health).not.toHaveProperty("stack");
    for (const job of health.failedJobs) {
      expect(job).not.toHaveProperty("data");
      expect(job).not.toHaveProperty("stack");
    }
  });

  it("reports 'unknown' worker status when no heartbeat has ever been recorded", async () => {
    const health = await getSystemHealth();
    expect(health.workerStatus).toBe("unknown");
    expect(health.lastHeartbeatAt).toBeNull();
  });

  it("reports database connectivity as up against the real test database", async () => {
    const health = await getSystemHealth();
    expect(health.databaseStatus).toBe("up");
  });

  it("returns a well-formed queue summary and failed-job list without crashing", async () => {
    // The test database's `pgboss` schema is a separate schema resetDatabase()
    // never truncates, so other integration tests exercising real pg-boss
    // mechanics (tests/integration/job-queue.test.ts) can leave real rows
    // behind — this only asserts the shape is well-formed, not emptiness.
    const health = await getSystemHealth();
    expect(Array.isArray(health.queueSummary)).toBe(true);
    expect(Array.isArray(health.failedJobs)).toBe(true);
    for (const queue of health.queueSummary) {
      expect(typeof queue.queue).toBe("string");
      expect(typeof queue.failed).toBe("number");
    }
  });
});
