import type { Job } from "pg-boss";
import type { Prisma } from "../../src/generated/prisma/client";
import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { getUserById } from "../../src/lib/auth/current-user";
import { parseReportFilters, resolveValidatedDateRange, type ReportFilters } from "../../src/lib/reports/filters";
import { buildReportRows, REPORT_KEYS, type ReportKey } from "../../src/lib/reports/build-rows";
import { computeNextRunAt, dateRangeKeyForCadence, type ReportCadenceValue } from "../../src/lib/reports/schedule";
import type { GenerateReportJobData } from "../../src/lib/jobs/enqueue";

/**
 * One Notification per recipient (type REPORT_GENERATED) — the
 * notification-bell's unread state for report generation, replacing the
 * seenByIds column Phase E removed from GeneratedReport. Fans out because
 * Notification is inherently per-user while a single GeneratedReport row
 * can have many recipients (ScheduledReport.recipientIds) with
 * independent read state.
 */
async function notifyRecipients(
  tx: Prisma.TransactionClient,
  schedule: { name: string; reportKey: string; recipientIds: string[] },
  generatedReportId: string,
  status: "SUCCEEDED" | "FAILED",
): Promise<void> {
  if (schedule.recipientIds.length === 0) return;
  await tx.notification.createMany({
    data: schedule.recipientIds.map((userId) => ({
      userId,
      type: "REPORT_GENERATED" as const,
      payload: { generatedReportId, reportKey: schedule.reportKey, name: schedule.name, status },
    })),
  });
}

/**
 * Writes a FAILED GeneratedReport row and advances the schedule to its next
 * period — used only for conditions retrying won't fix (a disabled/missing
 * creator, a lost permission, an invalid reportKey). A genuinely transient
 * error (DB hiccup, etc.) is NOT handled here — it propagates out of
 * handleGenerateReportJob so pg-boss applies its own retry/backoff against
 * the *same* still-due period, instead of this handler silently deciding
 * the period is done.
 */
async function recordPermanentFailure(
  schedule: { id: string; name: string; reportKey: string; cadence: ReportCadenceValue; nextRunAt: Date; recipientIds: string[] },
  periodStart: Date,
  message: string,
): Promise<void> {
  logger.warn({ scheduledReportId: schedule.id }, `generate-report: ${message}`);
  await prisma.$transaction(async (tx) => {
    // Module Ten idempotency guard: a pg-boss redelivery of this exact job
    // (e.g. the worker crashing after this transaction committed but before
    // the job was acked) must never duplicate the GeneratedReport row, the
    // fan-out Notifications, or double-advance nextRunAt. Checked first,
    // inside the same transaction, so the whole block becomes a no-op if
    // this period was already recorded. periodStart is the enqueue-time
    // periodKey (see handleGenerateReportJob), not a fresh read of
    // schedule.nextRunAt — that pointer is mutated by this very function on
    // success, so two invocations of what should be recognized as "the same
    // due period" would otherwise compute different periodStart values and
    // the guard above would never match (confirmed by an actual failing
    // regression test before this fix — a second invocation advanced
    // nextRunAt again and created a genuine duplicate row).
    const existing = await tx.generatedReport.findUnique({
      where: { scheduledReportId_periodStart: { scheduledReportId: schedule.id, periodStart } },
    });
    if (existing) return;

    const generated = await tx.generatedReport.create({
      data: {
        scheduledReportId: schedule.id,
        reportKey: schedule.reportKey,
        status: "FAILED",
        periodStart,
        periodEnd: periodStart,
        payload: { columns: [], rows: [] },
        recipientIds: schedule.recipientIds,
        errorMessage: message,
      },
    });
    await tx.scheduledReport.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), lastRunStatus: "FAILED", nextRunAt: computeNextRunAt(schedule.cadence, schedule.nextRunAt) },
    });
    await notifyRecipients(tx, schedule, generated.id, "FAILED");
  });
}

export async function handleGenerateReportJob(jobs: Job<GenerateReportJobData>[]): Promise<void> {
  const [job] = jobs;
  const { scheduledReportId, periodKey } = job.data;

  try {
    const schedule = await prisma.scheduledReport.findUnique({ where: { id: scheduledReportId } });
    if (!schedule || !schedule.active) {
      logger.info(`generate-report: schedule ${scheduledReportId} no longer exists or is inactive — skipping.`);
      return;
    }

    // Module Ten: the failure path's idempotency key must be the
    // enqueue-time due period (periodKey — set once by reports-tick.ts,
    // stable across every redelivery of this exact job), not a fresh read
    // of schedule.nextRunAt, which recordPermanentFailure itself advances
    // on success. Falls back to schedule.nextRunAt only if periodKey is
    // somehow missing/unparseable (defensive, not the expected path).
    const parsedPeriodKey = periodKey ? new Date(periodKey) : null;
    const failurePeriodStart = parsedPeriodKey && !Number.isNaN(parsedPeriodKey.getTime()) ? parsedPeriodKey : schedule.nextRunAt;

    if (!REPORT_KEYS.includes(schedule.reportKey as ReportKey)) {
      await recordPermanentFailure(schedule, failurePeriodStart, `Unrecognized report key "${schedule.reportKey}".`);
      return;
    }

    const creator = await getUserById(schedule.createdById);
    if (!creator || creator.disabled) {
      await recordPermanentFailure(schedule, failurePeriodStart, "The report creator's account is disabled or no longer exists.");
      return;
    }

    let filters: ReportFilters = { dateRange: dateRangeKeyForCadence(schedule.cadence) };
    if (schedule.savedViewId) {
      const savedView = await prisma.savedView.findUnique({ where: { id: schedule.savedViewId } });
      if (savedView) {
        filters = { ...parseReportFilters(savedView.filters), dateRange: dateRangeKeyForCadence(schedule.cadence) };
      }
    }

    const result = await buildReportRows(schedule.reportKey as ReportKey, creator, filters);
    if (result.forbidden) {
      await recordPermanentFailure(schedule, failurePeriodStart, "The report creator no longer has permission to view this report.");
      return;
    }

    const period = resolveValidatedDateRange(filters);

    await prisma.$transaction(async (tx) => {
      // Same idempotency guard as recordPermanentFailure() above.
      const existing = await tx.generatedReport.findUnique({
        where: { scheduledReportId_periodStart: { scheduledReportId: schedule.id, periodStart: period.start } },
      });
      if (existing) return;

      const generated = await tx.generatedReport.create({
        data: {
          scheduledReportId: schedule.id,
          reportKey: schedule.reportKey,
          status: "SUCCEEDED",
          periodStart: period.start,
          periodEnd: period.end,
          payload: { columns: result.columns, rows: result.rows },
          recipientIds: schedule.recipientIds,
        },
      });
      await tx.scheduledReport.update({
        where: { id: schedule.id },
        data: { lastRunAt: new Date(), lastRunStatus: "SUCCEEDED", nextRunAt: computeNextRunAt(schedule.cadence, schedule.nextRunAt) },
      });
      await notifyRecipients(tx, schedule, generated.id, "SUCCEEDED");
    });
  } catch (error) {
    logger.error({ err: error, jobId: job.id, scheduledReportId }, "generate-report job failed");
    await captureException(error, { jobId: job.id, scheduledReportId });
    throw error;
  }
}
