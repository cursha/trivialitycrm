"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { retryJob, cancelJob } from "@/lib/jobs/observability";
import { writeAuditEvent } from "@/lib/audit/log";

export type ActionResult = { error?: string } | undefined;

const PATH = "/administration/system-health";

async function requireJobManager() {
  const user = await requireUser();
  requirePermission(user, "manage_background_jobs");
  return user;
}

async function checkJobActionRateLimit(userId: string): Promise<string | null> {
  const rateLimit = await checkRateLimit(`job-action:${userId}`, { windowMs: 60_000, limit: 20 });
  return rateLimit.allowed ? null : "Too many job actions — please wait a moment and try again.";
}

export async function retryFailedJob(queue: string, jobId: string): Promise<ActionResult> {
  const user = await requireJobManager();
  const rateLimitError = await checkJobActionRateLimit(user.id);
  if (rateLimitError) return { error: rateLimitError };

  const result = await retryJob(queue, jobId);
  await writeAuditEvent({ actorId: user.id, module: "jobs", action: "job.retried", entityType: "Job", entityId: jobId, success: result.affected, metadata: { queue } });

  if (!result.affected) {
    return { error: "This job is no longer eligible for retry (it may have already been retried, completed, or been picked up)." };
  }

  revalidatePath(PATH);
}

export async function cancelEligibleJob(queue: string, jobId: string): Promise<ActionResult> {
  const user = await requireJobManager();
  const rateLimitError = await checkJobActionRateLimit(user.id);
  if (rateLimitError) return { error: rateLimitError };

  const result = await cancelJob(queue, jobId);
  await writeAuditEvent({ actorId: user.id, module: "jobs", action: "job.cancelled", entityType: "Job", entityId: jobId, success: result.affected, metadata: { queue } });

  if (!result.affected) {
    return { error: "This job is no longer eligible for cancellation (it may have already finished)." };
  }

  revalidatePath(PATH);
}
