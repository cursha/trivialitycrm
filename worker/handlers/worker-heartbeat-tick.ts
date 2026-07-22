import { prisma } from "../../src/lib/prisma";

/**
 * Runs every 2 minutes (see worker/main.ts). Touches the single
 * WorkerHeartbeat row so System Health (src/app/(dashboard)/administration/
 * system-health/) can show a genuine "last heartbeat" signal rather than
 * guessing worker liveness from indirect job activity — nothing in this
 * codebase tracked worker liveness before Module 8A.
 */
export async function runWorkerHeartbeatTick(): Promise<void> {
  // Prisma sets @updatedAt on every update, even with an empty `data`
  // object — this genuinely bumps the timestamp each tick, unlike
  // run-search.ts's superficially-similar `update: {}` (there, deliberately
  // a true no-op on an already-checkpointed row with no @updatedAt field).
  await prisma.workerHeartbeat.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}
