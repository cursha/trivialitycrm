import { exec } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import { getEnv } from "../src/lib/env";
import { logger } from "../src/lib/logger";
import {
  getBoss,
  startBoss,
  QUEUE_RUN_SEARCH,
  QUEUE_GENERATE_REPORT,
  QUEUE_SEND_SCHEDULED_EMAIL,
  QUEUE_RUN_SEQUENCE_STEP,
  QUEUE_PROCESS_INBOUND_NOTIFICATION,
} from "../src/lib/jobs/boss-client";
import { handleRunSearchJob } from "./handlers/run-search";
import { sweepExpiredSessions, sweepExpiredImportBatches, sweepExpiredRateLimitBuckets } from "./handlers/cleanup";
import { runReportsTick } from "./handlers/reports-tick";
import { handleGenerateReportJob } from "./handlers/generate-report";
import { runSendScheduledEmailTick } from "./handlers/send-scheduled-email-tick";
import { handleSendScheduledEmailJob } from "./handlers/send-scheduled-email";
import { runSequenceTick } from "./handlers/sequence-tick";
import { handleRunSequenceStepJob } from "./handlers/run-sequence-step";
import { runInboundSubscriptionTick } from "./handlers/inbound-subscription-tick";
import { handleProcessInboundNotificationJob } from "./handlers/process-inbound-notification";
import { shutdownBoss } from "./shutdown";

const execAsync = promisify(exec);

const QUEUE_CLEANUP_SESSIONS = "cleanup-sessions";
const QUEUE_CLEANUP_IMPORT_BATCHES = "cleanup-import-batches";
const QUEUE_CLEANUP_RATE_LIMIT_BUCKETS = "cleanup-rate-limit-buckets";
const QUEUE_REPORTS_TICK = "reports-tick";
const QUEUE_SEND_SCHEDULED_EMAIL_TICK = "send-scheduled-email-tick";
const QUEUE_SEQUENCE_TICK = "sequence-tick";
const QUEUE_INBOUND_SUBSCRIPTION_TICK = "inbound-subscription-tick";
const MIGRATION_GATE_POLL_MS = 5_000;
const MIGRATION_GATE_TIMEOUT_MS = 5 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until `prisma migrate status` reports the schema is current (exit
 * code 0), polling on a bound. Migrations are applied exactly once, by
 * Railway's Pre-Deploy Command on the web service (`npx prisma migrate
 * deploy`) — the worker never runs `migrate deploy` itself, only waits for
 * it to have finished, so it can never start consuming jobs against a
 * schema it hasn't confirmed is up to date. Exit-code contract (0 = current,
 * non-zero = pending or a transient error) verified empirically for this
 * Prisma version before relying on it here — see MODULE_3_REPORT.md.
 */
async function waitForMigrations(): Promise<void> {
  const deadline = Date.now() + MIGRATION_GATE_TIMEOUT_MS;

  for (;;) {
    try {
      // A shell-mediated command (exec, not execFile) is required on
      // Windows — `npx` resolves to `npx.cmd` there, which execFile cannot
      // spawn directly (fails with `spawn npx ENOENT`, confirmed by an
      // actual native-Windows run of this worker; Docker/Linux testing
      // never exercised this path since Linux has no such distinction).
      // The command is a fixed literal, never built from user input, so
      // shell interpretation here isn't an injection concern.
      await execAsync("npx --no-install prisma migrate status", { cwd: process.cwd() });
      logger.info("database schema is up to date.");
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`gave up waiting for migrations after ${MIGRATION_GATE_TIMEOUT_MS}ms.`);
      }
      // Logged at warn, not swallowed silently — a real spawn failure (e.g.
      // the Windows issue above) and a genuine "migrations pending" both
      // land here, and they need different fixes; without the underlying
      // message this loop just looks like an unexplained hang.
      logger.warn({ err: error }, "migrations not yet applied (or the status check itself failed) — waiting...");
      await delay(MIGRATION_GATE_POLL_MS);
    }
  }
}

/** Minimal HTTP listener purely for Railway's health check — this service
 * has no other reason to accept inbound connections. Never leaks config. */
function startHealthServer(): http.Server {
  const port = Number(process.env.PORT ?? 8080);
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => logger.info(`health listener on :${port}`));
  return server;
}

async function main(): Promise<void> {
  getEnv(); // fail fast on bad config, before anything else starts

  await waitForMigrations();

  const health = startHealthServer();
  const boss = await startBoss({ supervise: true });

  await boss.createQueue(QUEUE_CLEANUP_SESSIONS, { retryLimit: 1 });
  await boss.schedule(QUEUE_CLEANUP_SESSIONS, "*/15 * * * *");

  await boss.createQueue(QUEUE_CLEANUP_IMPORT_BATCHES, { retryLimit: 1 });
  await boss.schedule(QUEUE_CLEANUP_IMPORT_BATCHES, "*/15 * * * *");

  await boss.createQueue(QUEUE_CLEANUP_RATE_LIMIT_BUCKETS, { retryLimit: 1 });
  await boss.schedule(QUEUE_CLEANUP_RATE_LIMIT_BUCKETS, "0 * * * *");

  await boss.createQueue(QUEUE_REPORTS_TICK, { retryLimit: 1 });
  await boss.schedule(QUEUE_REPORTS_TICK, "0 * * * *");

  // Every 5 minutes, not hourly like reports-tick — a "send at 2pm" user
  // expectation of timeliness that report generation doesn't have.
  await boss.createQueue(QUEUE_SEND_SCHEDULED_EMAIL_TICK, { retryLimit: 1 });
  await boss.schedule(QUEUE_SEND_SCHEDULED_EMAIL_TICK, "*/5 * * * *");

  await boss.createQueue(QUEUE_SEQUENCE_TICK, { retryLimit: 1 });
  await boss.schedule(QUEUE_SEQUENCE_TICK, "*/5 * * * *");

  await boss.createQueue(QUEUE_INBOUND_SUBSCRIPTION_TICK, { retryLimit: 1 });
  await boss.schedule(QUEUE_INBOUND_SUBSCRIPTION_TICK, "0 * * * *");

  await boss.work(QUEUE_RUN_SEARCH, { localConcurrency: 1 }, handleRunSearchJob);
  await boss.work(QUEUE_GENERATE_REPORT, { localConcurrency: 1 }, handleGenerateReportJob);
  await boss.work(QUEUE_SEND_SCHEDULED_EMAIL, { localConcurrency: 1 }, handleSendScheduledEmailJob);
  await boss.work(QUEUE_RUN_SEQUENCE_STEP, { localConcurrency: 1 }, handleRunSequenceStepJob);
  await boss.work(QUEUE_PROCESS_INBOUND_NOTIFICATION, { localConcurrency: 1 }, handleProcessInboundNotificationJob);
  await boss.work(QUEUE_CLEANUP_SESSIONS, async () => {
    await sweepExpiredSessions();
  });
  await boss.work(QUEUE_CLEANUP_IMPORT_BATCHES, async () => {
    await sweepExpiredImportBatches();
  });
  await boss.work(QUEUE_CLEANUP_RATE_LIMIT_BUCKETS, async () => {
    await sweepExpiredRateLimitBuckets();
  });
  await boss.work(QUEUE_REPORTS_TICK, async () => {
    await runReportsTick();
  });
  await boss.work(QUEUE_SEND_SCHEDULED_EMAIL_TICK, async () => {
    await runSendScheduledEmailTick();
  });
  await boss.work(QUEUE_SEQUENCE_TICK, async () => {
    await runSequenceTick();
  });
  await boss.work(QUEUE_INBOUND_SUBSCRIPTION_TICK, async () => {
    await runInboundSubscriptionTick();
  });

  boss.on("error", (error) => logger.error({ err: error }, "pg-boss error"));

  logger.info("worker started, listening for jobs.");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down gracefully...`);
    health.close();
    await shutdownBoss(getBoss());
    logger.info("shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  logger.error({ err: error }, "fatal startup error");
  process.exit(1);
});
