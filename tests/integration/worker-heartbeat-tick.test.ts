import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { resetFakeCookies } from "../setup/mock-next";
import { runWorkerHeartbeatTick } from "../../worker/handlers/worker-heartbeat-tick";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("runWorkerHeartbeatTick", () => {
  it("creates the heartbeat row on the first tick", async () => {
    await runWorkerHeartbeatTick();
    const heartbeat = await testPrisma.workerHeartbeat.findUniqueOrThrow({ where: { id: 1 } });
    expect(heartbeat.updatedAt).toBeInstanceOf(Date);
  });

  it("advances updatedAt on every subsequent tick, not just the first", async () => {
    await runWorkerHeartbeatTick();
    const first = await testPrisma.workerHeartbeat.findUniqueOrThrow({ where: { id: 1 } });

    // Backdate it the way a genuinely stale heartbeat would look, so the
    // next tick's bump is unambiguous regardless of how fast the two calls
    // happen to run in this test.
    await testPrisma.workerHeartbeat.update({ where: { id: 1 }, data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    const backdated = await testPrisma.workerHeartbeat.findUniqueOrThrow({ where: { id: 1 } });

    await runWorkerHeartbeatTick();
    const second = await testPrisma.workerHeartbeat.findUniqueOrThrow({ where: { id: 1 } });

    expect(second.updatedAt.getTime()).toBeGreaterThan(backdated.updatedAt.getTime());
    expect(second.updatedAt.getTime()).not.toBe(first.updatedAt.getTime());
  });
});
