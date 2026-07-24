import { prisma } from "../../src/lib/prisma";

/**
 * Runs every 2 minutes (see worker/main.ts). Touches the single
 * WorkerHeartbeat row so System Health (src/app/(dashboard)/administration/
 * system-health/) can show a genuine "last heartbeat" signal rather than
 * guessing worker liveness from indirect job activity — nothing in this
 * codebase tracked worker liveness before Module 8A.
 */
export async function runWorkerHeartbeatTick(): Promise<void> {
  // Module Ten: a genuinely empty `update: {}` does NOT bump @updatedAt —
  // confirmed against this exact Prisma version; an update with no fields
  // to set is optimized away entirely, so the row's `updatedAt` silently
  // never advances past its first tick. (The previous comment here claimed
  // otherwise and was simply wrong — caught by a regression test added
  // alongside this fix.) Setting `updatedAt` explicitly is what actually
  // works, matching run-search.ts's genuinely-different `update: {}` case
  // only in that both use upsert, not in this specific behavior.
  await prisma.workerHeartbeat.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: { updatedAt: new Date() },
  });
}
