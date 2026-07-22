"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { enqueueDataQualityScanJob, cancelDataQualityScanJob } from "@/lib/jobs/enqueue";

export type ScanActionResult = { error?: string } | undefined;

const PATH = "/data-quality/scans";

// Expensive, full-table operation — one trigger per user per 5 minutes,
// same checkRateLimit mechanism every other rate-limited action in this app
// already uses (src/lib/rate-limit/postgres-bucket.ts).
const SCAN_RATE_LIMIT = { windowMs: 5 * 60 * 1000, limit: 1 };

export async function triggerDataQualityScan(entityType: "COMPANY" | "CONTACT" | null): Promise<ScanActionResult> {
  const user = await requireUser();
  requirePermission(user, "run_duplicate_scan");

  const rateLimit = await checkRateLimit(`data-quality-scan:${user.id}`, SCAN_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return { error: "A scan was started recently — please wait a few minutes before starting another." };
  }

  const alreadyRunning = await prisma.dataQualityScan.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  if (alreadyRunning) {
    return { error: "A scan is already running." };
  }

  const scan = await prisma.dataQualityScan.create({ data: { entityType, triggeredById: user.id } });
  const jobId = await enqueueDataQualityScanJob(scan.id);
  await prisma.dataQualityScan.update({ where: { id: scan.id }, data: { providerJobId: jobId } });

  await prisma.dataQualityAuditEvent.create({ data: { action: "SCAN_STARTED", actorId: user.id, metadata: { scanId: scan.id, entityType } } });

  revalidatePath(PATH);
}

export async function cancelScan(scanId: string): Promise<ScanActionResult> {
  const user = await requireUser();
  requirePermission(user, "run_duplicate_scan");

  const scan = await prisma.dataQualityScan.findUnique({ where: { id: scanId } });
  if (!scan || (scan.status !== "PENDING" && scan.status !== "RUNNING")) {
    return { error: "This scan can no longer be cancelled." };
  }

  if (scan.providerJobId) {
    await cancelDataQualityScanJob(scan.providerJobId);
  }
  await prisma.dataQualityScan.update({ where: { id: scanId }, data: { status: "CANCELLED", completedAt: new Date() } });
  await prisma.dataQualityAuditEvent.create({ data: { action: "SCAN_CANCELLED", actorId: user.id, metadata: { scanId } } });

  revalidatePath(PATH);
}
