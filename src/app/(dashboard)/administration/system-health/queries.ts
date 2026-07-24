import "server-only";
import { prisma } from "@/lib/prisma";
import { getQueueSummary, getRecentFailedJobs } from "@/lib/jobs/observability";
import { isAiApiKeyConfigured } from "@/lib/ai/budget";
import { getEnv } from "@/lib/env";
import { isHeartbeatStale } from "@/lib/ops/worker-heartbeat";
import packageJson from "../../../../../package.json";

export type SystemHealth = {
  webStatus: "up";
  databaseStatus: "up" | "down";
  workerStatus: "healthy" | "stale" | "unknown";
  lastHeartbeatAt: string | null;
  migrationsClean: boolean | null;
  queueSummary: Awaited<ReturnType<typeof getQueueSummary>>;
  failedJobs: Awaited<ReturnType<typeof getRecentFailedJobs>>;
  appVersion: string;
  buildId: string | null;
  aiProviderMode: string;
  aiApiKeyConfigured: boolean;
  microsoftConfigured: boolean;
  googleConfigured: boolean;
  connectedMailboxCount: number;
};

export async function getSystemHealth(): Promise<SystemHealth> {
  let databaseStatus: "up" | "down" = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseStatus = "down";
  }

  const heartbeat = await prisma.workerHeartbeat.findUnique({ where: { id: 1 } });
  let workerStatus: SystemHealth["workerStatus"] = "unknown";
  if (heartbeat) {
    workerStatus = isHeartbeatStale(heartbeat.updatedAt, new Date()) ? "stale" : "healthy";
  }

  // Any migration row with no finished_at is incomplete/failed — a real,
  // request-cheap signal, not full drift detection (see the plan's
  // "migration readiness" decision).
  let migrationsClean: boolean | null = null;
  try {
    const incomplete = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM _prisma_migrations WHERE finished_at IS NULL
    `;
    migrationsClean = Number(incomplete[0]?.count ?? 0) === 0;
  } catch {
    migrationsClean = null;
  }

  const [queueSummary, failedJobs, connectedMailboxCount] = await Promise.all([
    getQueueSummary(),
    getRecentFailedJobs(25),
    prisma.providerConnection.count({ where: { status: "CONNECTED" } }),
  ]);

  const env = getEnv();

  return {
    webStatus: "up",
    databaseStatus,
    workerStatus,
    lastHeartbeatAt: heartbeat ? heartbeat.updatedAt.toISOString() : null,
    migrationsClean,
    queueSummary,
    failedJobs,
    appVersion: packageJson.version,
    buildId: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
    aiProviderMode: env.AI_PROVIDER,
    aiApiKeyConfigured: isAiApiKeyConfigured(),
    microsoftConfigured: Boolean(env.MICROSOFT_CLIENT_ID),
    googleConfigured: Boolean(env.GOOGLE_CLIENT_ID),
    connectedMailboxCount,
  };
}
