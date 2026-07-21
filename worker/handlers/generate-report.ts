import type { Job } from "pg-boss";
import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { getUserById } from "../../src/lib/auth/current-user";
import { parseReportFilters, resolveValidatedDateRange, type ReportFilters } from "../../src/lib/reports/filters";
import { buildReportRows, REPORT_KEYS, type ReportKey } from "../../src/lib/reports/build-rows";
import { computeNextRunAt, dateRangeKeyForCadence, type ReportCadenceValue } from "../../src/lib/reports/schedule";
import type { GenerateReportJobData } from "../../src/lib/jobs/enqueue";

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
  schedule: { id: string; reportKey: string; cadence: ReportCadenceValue; nextRunAt: Date; recipientIds: string[] },
  message: string,
): Promise<void> {
  logger.warn({ scheduledReportId: schedule.id }, `generate-report: ${message}`);
  await prisma.$transaction([
    prisma.generatedReport.create({
      data: {
        scheduledReportId: schedule.id,
        reportKey: schedule.reportKey,
        status: "FAILED",
        periodStart: schedule.nextRunAt,
        periodEnd: schedule.nextRunAt,
        payload: { columns: [], rows: [] },
        recipientIds: schedule.recipientIds,
        errorMessage: message,
      },
    }),
    prisma.scheduledReport.update({
      where: { id: schedule.id },
      data: { lastRunAt: new Date(), lastRunStatus: "FAILED", nextRunAt: computeNextRunAt(schedule.cadence, schedule.nextRunAt) },
    }),
  ]);
}

export async function handleGenerateReportJob(jobs: Job<GenerateReportJobData>[]): Promise<void> {
  const [job] = jobs;
  const { scheduledReportId } = job.data;

  try {
    const schedule = await prisma.scheduledReport.findUnique({ where: { id: scheduledReportId } });
    if (!schedule || !schedule.active) {
      logger.info(`generate-report: schedule ${scheduledReportId} no longer exists or is inactive — skipping.`);
      return;
    }

    if (!REPORT_KEYS.includes(schedule.reportKey as ReportKey)) {
      await recordPermanentFailure(schedule, `Unrecognized report key "${schedule.reportKey}".`);
      return;
    }

    const creator = await getUserById(schedule.createdById);
    if (!creator || creator.disabled) {
      await recordPermanentFailure(schedule, "The report creator's account is disabled or no longer exists.");
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
      await recordPermanentFailure(schedule, "The report creator no longer has permission to view this report.");
      return;
    }

    const period = resolveValidatedDateRange(filters);

    await prisma.$transaction([
      prisma.generatedReport.create({
        data: {
          scheduledReportId: schedule.id,
          reportKey: schedule.reportKey,
          status: "SUCCEEDED",
          periodStart: period.start,
          periodEnd: period.end,
          payload: { columns: result.columns, rows: result.rows },
          recipientIds: schedule.recipientIds,
        },
      }),
      prisma.scheduledReport.update({
        where: { id: schedule.id },
        data: { lastRunAt: new Date(), lastRunStatus: "SUCCEEDED", nextRunAt: computeNextRunAt(schedule.cadence, schedule.nextRunAt) },
      }),
    ]);
  } catch (error) {
    logger.error({ err: error, jobId: job.id, scheduledReportId }, "generate-report job failed");
    await captureException(error, { jobId: job.id, scheduledReportId });
    throw error;
  }
}
