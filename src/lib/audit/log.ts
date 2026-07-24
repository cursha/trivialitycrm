// The app's one generic, cross-module audit writer — deliberately separate
// from Module Seven's DataQualityAuditEvent (see prisma/schema.prisma's
// AuditEvent doc comment for why). Every new Module 8A action calls this
// instead of writing prisma.auditEvent.create inline, since call sites here
// are more numerous and varied than Module Seven's.
//
// No `import "server-only"` — src/lib/research/run-search.ts (which runs in
// the worker under plain tsx) needs this too, to audit a mid-run AI-budget
// block (Module Nine). Same reasoning as src/lib/prisma.ts's identical
// omission; confirmed no "use client" file imports this module.
import crypto from "node:crypto";
import { prisma } from "../prisma";
import type { Prisma } from "../../generated/prisma/client";

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export type WriteAuditEventParams = {
  actorId: string | null;
  module: string;
  action: string;
  entityType?: string;
  entityId?: string;
  /** A blocked/failed attempt is recorded too, not only successes — see the
   * schema doc comment. Defaults true (the common case: the action
   * succeeded). */
  success?: boolean;
  correlationId?: string;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
};

export async function writeAuditEvent(params: WriteAuditEventParams): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorId: params.actorId,
      module: params.module,
      action: params.action,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
      success: params.success ?? true,
      correlationId: params.correlationId ?? null,
      beforeData: (params.beforeData ?? undefined) as Prisma.InputJsonValue | undefined,
      afterData: (params.afterData ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
