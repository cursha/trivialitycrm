import { prisma } from "../../src/lib/prisma";
import { Prisma } from "../../src/generated/prisma/client";
import { logger } from "../../src/lib/logger";

/**
 * Expired sessions are otherwise only ever lazily deleted the next time
 * someone happens to present that exact cookie (see getSessionUserId in
 * src/lib/auth/session.ts) — a session nobody polls again just accumulates
 * forever. This is a real, previously-unaddressed gap; run on a schedule
 * from worker/index.ts. Deliberately count-and-log rather than silent, so an
 * unexpectedly large sweep is visible in worker logs.
 */
export async function sweepExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  if (result.count > 0) {
    logger.info(`cleanup: removed ${result.count} expired session(s).`);
  }
  return result.count;
}

/**
 * Two-stage cleanup for ImportBatch rows nobody ever committed:
 *  1. Any row past its expiresAt with a still-present payload gets that
 *     payload wiped immediately (the actual spreadsheet contents are gone
 *     at this point — see batch-store.ts's clearUpload) and its status set
 *     to EXPIRED.
 *  2. Rows that have been EXPIRED (or already IMPORTED) for longer than the
 *     grace period are hard-deleted — by then the payload is already gone,
 *     this just prunes the metadata row (filename/rowCount/timestamps) that
 *     was kept briefly for admin troubleshooting.
 */
const DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export async function sweepExpiredImportBatches(): Promise<{ expired: number; deleted: number }> {
  const now = new Date();

  const expired = await prisma.importBatch.updateMany({
    where: { expiresAt: { lt: now }, payload: { not: Prisma.DbNull } },
    data: { payload: Prisma.DbNull, status: "EXPIRED" },
  });

  const deleted = await prisma.importBatch.deleteMany({
    where: {
      status: { in: ["EXPIRED", "IMPORTED", "FAILED"] },
      updatedAt: { lt: new Date(now.getTime() - DELETION_GRACE_MS) },
    },
  });

  if (expired.count > 0 || deleted.count > 0) {
    logger.info(`cleanup: expired ${expired.count} import batch payload(s), deleted ${deleted.count} old batch row(s).`);
  }

  return { expired: expired.count, deleted: deleted.count };
}

/**
 * RateLimitBucket rows are only ever meaningful for the duration of their
 * own window (the longest currently in use is the 5-minute login IP window)
 * — anything older than that is dead weight. A generous 1-hour cutoff
 * leaves headroom for any window size in use without needing to know each
 * caller's specific windowMs here.
 */
const RATE_LIMIT_BUCKET_RETENTION_MS = 60 * 60 * 1000;

export async function sweepExpiredRateLimitBuckets(): Promise<number> {
  const result = await prisma.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - RATE_LIMIT_BUCKET_RETENTION_MS) } },
  });
  if (result.count > 0) {
    logger.info(`cleanup: removed ${result.count} expired rate-limit bucket(s).`);
  }
  return result.count;
}

/**
 * Mailing-label retention: once a batch is older than the configured
 * retention (MailingLabelSettings.retentionDays, 365 by default), its
 * recipients' names and addresses are cleared. The batch keeps its counts,
 * sheet, dates and printed/mailed confirmations (non-personal history) but
 * can no longer be reprinted. Drafts are live working state, not history,
 * and are left alone.
 */
export async function sweepExpiredLabelBatches(): Promise<number> {
  const settings = await prisma.mailingLabelSettings.findUnique({ where: { id: 1 } });
  const days = settings?.retentionDays ?? 365;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const expired = await prisma.mailingLabelBatch.findMany({ where: { createdAt: { lt: cutoff }, recipientsPurgedAt: null }, select: { id: true }, take: 500 });
  if (expired.length === 0) return 0;
  const ids = expired.map((b) => b.id);
  await prisma.$transaction([
    prisma.mailingLabelRecipient.updateMany({ where: { batchId: { in: ids } }, data: { companyName: "", lines: [], contactId: null } }),
    prisma.mailingLabelBatch.updateMany({ where: { id: { in: ids } }, data: { recipientsPurgedAt: new Date(), exclusions: [] } }),
  ]);
  logger.info(`cleanup: cleared names and addresses on ${ids.length} mailing-label batch(es) past retention.`);
  return ids.length;
}
