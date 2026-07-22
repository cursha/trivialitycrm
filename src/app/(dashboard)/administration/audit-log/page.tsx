import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { describeAuditEvent } from "@/lib/audit/describe";
import { redactSensitiveData } from "@/lib/audit/redact";
import type { Prisma } from "@/generated/prisma/client";
import { AuditLogFilters } from "./audit-log-filters";
import { AuditEventList } from "./audit-event-list";

export const metadata = { title: "Audit Log — Triviality CRM" };

const PAGE_SIZE = 50;

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  requirePermission(user, "view_audit_log");

  const params = await searchParams;
  const from = toSingle(params.from);
  const to = toSingle(params.to);
  const actorId = toSingle(params.actorId);
  const module_ = toSingle(params.module);
  const action = toSingle(params.action);
  const entityType = toSingle(params.entityType);
  const entityId = toSingle(params.entityId);
  const success = toSingle(params.success);
  const correlationId = toSingle(params.correlationId);
  const page = Math.max(1, Number(toSingle(params.page)) || 1);

  const where: Prisma.AuditEventWhereInput = {
    ...(from || to ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    ...(actorId ? { actorId } : {}),
    ...(module_ ? { module: module_ } : {}),
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(success ? { success: success === "true" } : {}),
    ...(correlationId ? { correlationId } : {}),
  };

  const [events, total, actors, modules] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: { id: true, name: true } } },
    }),
    prisma.auditEvent.count({ where }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.auditEvent.findMany({ distinct: ["module"], select: { module: true }, orderBy: { module: "asc" } }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function hrefFor(targetPage: number) {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (actorId) qs.set("actorId", actorId);
    if (module_) qs.set("module", module_);
    if (action) qs.set("action", action);
    if (entityType) qs.set("entityType", entityType);
    if (entityId) qs.set("entityId", entityId);
    if (success) qs.set("success", success);
    if (correlationId) qs.set("correlationId", correlationId);
    qs.set("page", String(targetPage));
    return `/administration/audit-log?${qs.toString()}`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Audit Log" description="A secure, read-only record of administrative actions. Sensitive values are always redacted, and no record here can be edited or deleted through the application." />

      <AuditLogFilters
        actors={actors}
        modules={modules.map((m) => m.module)}
        canExport={hasPermission(user, "export_audit_log")}
        currentFilters={{ from, to, actorId, module: module_, action, entityType, entityId, success, correlationId }}
      />

      <AuditEventList
        total={total}
        events={events.map((event) => ({
          id: event.id,
          summary: describeAuditEvent(event),
          actorName: event.actor?.name ?? "System",
          module: event.module,
          action: event.action,
          success: event.success,
          entityType: event.entityType,
          entityId: event.entityId,
          correlationId: event.correlationId,
          occurredAt: event.occurredAt.toISOString(),
          before: redactSensitiveData(event.beforeData ?? null),
          after: redactSensitiveData(event.afterData ?? null),
        }))}
      />

      <Pagination page={page} pageCount={pageCount} pageSize={PAGE_SIZE} hrefFor={hrefFor} />
    </div>
  );
}
