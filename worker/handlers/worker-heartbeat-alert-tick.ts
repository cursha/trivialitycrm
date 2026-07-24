import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { sendSystemEmail } from "../../src/lib/transactional/send-system-email";
import { decideHeartbeatAlertAction } from "../../src/lib/ops/worker-heartbeat";

/**
 * Runs every 5 minutes (see worker/main.ts). Emails every user who can
 * manage background jobs when the worker heartbeat goes stale, and clears
 * the alert once it recovers so a later, separate stale episode alerts
 * again instead of staying silenced forever.
 *
 * Known, honest limitation: this check runs as a pg-boss scheduled tick
 * inside the worker process itself. If the worker process is fully down
 * (not just stuck on a hung job), this tick can't run either, so it can't
 * alert on a total outage — only on the worker being alive but not ticking
 * cleanly. Catching a fully-dead worker needs an external monitor outside
 * this application, which is out of scope here (no paid monitoring
 * provider without separate approval). System Health's on-page-load check
 * is the fallback for a total outage.
 */
export async function runWorkerHeartbeatAlertTick(): Promise<void> {
  const heartbeat = await prisma.workerHeartbeat.findUnique({ where: { id: 1 } });
  if (!heartbeat) return; // no tick has ever run yet — nothing to alert on

  const alertState = await prisma.workerHeartbeatAlert.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });

  const now = new Date();
  const action = decideHeartbeatAlertAction({ updatedAt: heartbeat.updatedAt, staleAlertSentAt: alertState.staleAlertSentAt }, now);

  if (action === "NONE") return;

  if (action === "CLEAR_ALERT") {
    await prisma.workerHeartbeatAlert.update({ where: { id: 1 }, data: { staleAlertSentAt: null } });
    logger.info("worker-heartbeat-alert: heartbeat recovered — alert state cleared.");
    return;
  }

  const recipients = await prisma.user.findMany({
    where: { disabled: false, role: { permissions: { some: { allowed: true, permission: { key: "manage_background_jobs" } } } } },
    select: { id: true, email: true },
  });

  const episodeKey = heartbeat.updatedAt.toISOString();
  for (const recipient of recipients) {
    const result = await sendSystemEmail({
      purpose: "SYSTEM_ALERT",
      toAddress: recipient.email,
      subject: "Triviality CRM: worker heartbeat is stale",
      bodyText:
        `The background worker's last heartbeat was at ${heartbeat.updatedAt.toISOString()}, more than a few minutes ago. ` +
        "Background jobs (AI research, scheduled email, reports, follow-up sequences) may be delayed or not running. " +
        "Check System Health in the CRM administration area.",
      idempotencyKey: `worker-heartbeat-alert:${episodeKey}:${recipient.id}`,
    });
    if (!result.ok) {
      logger.warn({ userId: recipient.id, error: result.error }, "worker-heartbeat-alert: failed to queue alert email.");
    }
  }

  await prisma.workerHeartbeatAlert.update({ where: { id: 1 }, data: { staleAlertSentAt: now } });
  logger.warn({ recipientCount: recipients.length }, "worker-heartbeat-alert: heartbeat is stale — alert sent.");
}
