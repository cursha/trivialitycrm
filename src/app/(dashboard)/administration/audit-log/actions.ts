"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { redactSensitiveData } from "@/lib/audit/redact";
import { describeAuditEvent } from "@/lib/audit/describe";
import { buildCsv } from "@/lib/export/serialize";
import { writeAuditEvent } from "@/lib/audit/log";
import type { Prisma } from "@/generated/prisma/client";

export type ExportResult = { error?: string; csv?: string };

const EXPORT_ROW_CAP = 5000;

const EXPORT_COLUMNS = [
  { key: "occurredAt", label: "Occurred At" },
  { key: "actor", label: "Actor" },
  { key: "module", label: "Module" },
  { key: "action", label: "Action" },
  { key: "success", label: "Success" },
  { key: "entityType", label: "Entity Type" },
  { key: "entityId", label: "Entity ID" },
  { key: "correlationId", label: "Correlation ID" },
  { key: "summary", label: "Summary" },
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
  { key: "metadata", label: "Metadata" },
];

export async function exportAuditLog(filters: {
  from?: string;
  to?: string;
  actorId?: string;
  module?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  success?: string;
  correlationId?: string;
}): Promise<ExportResult> {
  const user = await requireUser();
  requirePermission(user, "export_audit_log");

  // Expensive, potentially-large export — one per user per 5 minutes, same
  // mechanism every other rate-limited action in this app already uses.
  const rateLimit = await checkRateLimit(`audit-export:${user.id}`, { windowMs: 5 * 60 * 1000, limit: 1 });
  if (!rateLimit.allowed) {
    return { error: "An export was started recently — please wait a few minutes before exporting again." };
  }

  const where: Prisma.AuditEventWhereInput = {
    ...(filters.from || filters.to
      ? { occurredAt: { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } }
      : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.module ? { module: filters.module } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.success ? { success: filters.success === "true" } : {}),
    ...(filters.correlationId ? { correlationId: filters.correlationId } : {}),
  };

  const events = await prisma.auditEvent.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: EXPORT_ROW_CAP,
    include: { actor: { select: { name: true, email: true } } },
  });

  // Every value passes through redactSensitiveData before it ever reaches
  // buildCsv — the exact same redaction pass the on-screen viewer uses
  // (src/lib/audit/redact.ts), so an export can never show something the
  // viewer itself would have hidden.
  const rows = events.map((event) => ({
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actor?.email ?? "System",
    module: event.module,
    action: event.action,
    success: event.success ? "true" : "false",
    entityType: event.entityType ?? "",
    entityId: event.entityId ?? "",
    correlationId: event.correlationId ?? "",
    summary: describeAuditEvent(event),
    before: JSON.stringify(redactSensitiveData(event.beforeData ?? null)),
    after: JSON.stringify(redactSensitiveData(event.afterData ?? null)),
    metadata: JSON.stringify(redactSensitiveData(event.metadata ?? null)),
  }));

  const csv = buildCsv(EXPORT_COLUMNS, rows);

  await writeAuditEvent({ actorId: user.id, module: "audit", action: "audit_log.exported", metadata: { rowCount: events.length, filters } });

  return { csv };
}
