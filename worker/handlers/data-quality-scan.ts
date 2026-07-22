import type { Job } from "pg-boss";
import { prisma } from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { captureException } from "../../src/lib/error-reporting";
import { runDataQualityScan } from "../../src/lib/data-quality/scan";
import type { DataQualityScanJobData } from "../../src/lib/jobs/enqueue";

async function isScanCancelled(scanId: string): Promise<boolean> {
  const scan = await prisma.dataQualityScan.findUnique({ where: { id: scanId }, select: { status: true } });
  return scan?.status === "CANCELLED";
}

/**
 * pg-boss work() handler for the data-quality-scan queue — same wrapper
 * idiom as worker/handlers/run-search.ts: runDataQualityScan never throws
 * (it persists FAILED/errorMessage on the DataQualityScan row itself), this
 * wrapper re-derives failure from that row afterward and throws only here,
 * at the pg-boss integration boundary, so the queue records retry/failure.
 */
export async function handleDataQualityScanJob(jobs: Job<DataQualityScanJobData>[]): Promise<void> {
  const [job] = jobs;
  const { scanId } = job.data;

  await runDataQualityScan(scanId, { isCancelled: () => isScanCancelled(scanId) });

  const result = await prisma.dataQualityScan.findUnique({ where: { id: scanId }, select: { status: true, errorMessage: true } });
  if (result?.status === "FAILED") {
    const message = result.errorMessage ?? "Data quality scan failed.";
    const error = new Error(message);
    logger.error({ jobId: job.id, scanId }, `data-quality-scan job failed: ${message}`);
    await captureException(error, { jobId: job.id, scanId });
    throw error;
  }
}
