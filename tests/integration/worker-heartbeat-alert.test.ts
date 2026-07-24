import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { runWorkerHeartbeatAlertTick } from "../../worker/handlers/worker-heartbeat-alert-tick";
import { HEARTBEAT_FRESHNESS_MS } from "../../src/lib/ops/worker-heartbeat";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function adminUser(email = "ops-admin@example.test") {
  const role = await createRoleWithPermissions("OpsAdmin", ["manage_background_jobs"]);
  return createTestUser({ roleId: role.id, email });
}

function staleTimestamp(): Date {
  return new Date(Date.now() - HEARTBEAT_FRESHNESS_MS - 60_000);
}

describe("runWorkerHeartbeatAlertTick", () => {
  it("does nothing when there is no heartbeat row yet", async () => {
    await adminUser();
    await runWorkerHeartbeatAlertTick();
    expect(await testPrisma.transactionalEmailMessage.count()).toBe(0);
  });

  it("does nothing while the heartbeat is fresh", async () => {
    await adminUser();
    await testPrisma.workerHeartbeat.create({ data: { id: 1 } });
    await runWorkerHeartbeatAlertTick();
    expect(await testPrisma.transactionalEmailMessage.count()).toBe(0);
  });

  it("emails every user who can manage background jobs when the heartbeat goes stale", async () => {
    const admin = await adminUser("ops-admin@example.test");
    const otherAdminRole = await createRoleWithPermissions("OpsAdmin2", ["manage_background_jobs"]);
    const otherAdmin = await createTestUser({ roleId: otherAdminRole.id, email: "ops-admin-2@example.test" });
    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: salespersonRole.id, email: "not-an-admin@example.test" });

    await testPrisma.workerHeartbeat.create({ data: { updatedAt: staleTimestamp() } });

    await runWorkerHeartbeatAlertTick();

    const messages = await testPrisma.transactionalEmailMessage.findMany({ where: { purpose: "SYSTEM_ALERT" } });
    expect(messages.map((m) => m.toAddress).sort()).toEqual([admin.email, otherAdmin.email].sort());

    const alertState = await testPrisma.workerHeartbeatAlert.findUniqueOrThrow({ where: { id: 1 } });
    expect(alertState.staleAlertSentAt).not.toBeNull();
  });

  it("does not send a second alert for the same ongoing stale episode", async () => {
    await adminUser();
    await testPrisma.workerHeartbeat.create({ data: { updatedAt: staleTimestamp() } });

    await runWorkerHeartbeatAlertTick();
    await runWorkerHeartbeatAlertTick();

    expect(await testPrisma.transactionalEmailMessage.count({ where: { purpose: "SYSTEM_ALERT" } })).toBe(1);
  });

  it("clears the alert state once the heartbeat recovers, allowing a future episode to alert again", async () => {
    await adminUser();
    await testPrisma.workerHeartbeat.create({ data: { updatedAt: staleTimestamp() } });
    await runWorkerHeartbeatAlertTick();
    expect(await testPrisma.transactionalEmailMessage.count({ where: { purpose: "SYSTEM_ALERT" } })).toBe(1);

    // Worker "recovers" — a fresh tick bumps updatedAt back to now. An
    // empty `data: {}` would NOT do this (a genuinely empty Prisma update
    // is optimized away and never touches @updatedAt — the exact bug this
    // module found and fixed in worker-heartbeat-tick.ts), so this must set
    // updatedAt explicitly, matching that fix.
    await testPrisma.workerHeartbeat.update({ where: { id: 1 }, data: { updatedAt: new Date() } });
    await runWorkerHeartbeatAlertTick();
    const clearedState = await testPrisma.workerHeartbeatAlert.findUniqueOrThrow({ where: { id: 1 } });
    expect(clearedState.staleAlertSentAt).toBeNull();

    // Goes stale again — a genuinely new episode should alert again.
    await testPrisma.workerHeartbeat.update({ where: { id: 1 }, data: { updatedAt: staleTimestamp() } });
    await runWorkerHeartbeatAlertTick();
    expect(await testPrisma.transactionalEmailMessage.count({ where: { purpose: "SYSTEM_ALERT" } })).toBe(2);
  });
});
