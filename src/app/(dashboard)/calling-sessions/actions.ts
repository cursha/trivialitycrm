"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { writeAuditEvent } from "@/lib/audit/log";
import { salesListVisibilityWhere } from "@/lib/sales-lists/scope";
import { getLastContactDates } from "@/lib/sales-lists/queries";
import { companyScope } from "@/lib/companies/scope";
import { hasPermission } from "@/lib/auth/permissions";
import { getEligibleCompaniesForCalling, getActiveSessionForUser, getOwnedSession, getNextEntry } from "@/lib/calling/queries";
import { sortCompaniesForCalling } from "@/lib/calling/order";
import { logCallActivity } from "@/lib/calling/activity-log";
import { logPipelineChange } from "@/lib/companies/activity-log";

export type CallingSessionActionResult = { error: string } | { success: true; id: string };

export async function startCallingSession(listId: string, override?: { orderBy?: string; orderDir?: string }): Promise<CallingSessionActionResult> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");

  const existing = await getActiveSessionForUser(user.id);
  if (existing) return { error: "You already have a calling session in progress — resume or end it before starting a new one." };

  const listScope = salesListVisibilityWhere(user);
  if (!listScope) return { error: "List not found." };
  const list = await prisma.salesList.findFirst({ where: { id: listId, ...listScope } });
  if (!list) return { error: "List not found." };
  if (list.purpose !== "CALLING") return { error: "Only a Calling List can start a calling session." };

  const eligible = await getEligibleCompaniesForCalling(user, list);
  if (eligible.length === 0) return { error: "No eligible companies on this list right now." };

  const settings = await prisma.workspaceSettings.findUnique({ where: { id: 1 } });
  const orderBy = override?.orderBy ?? settings?.defaultCallingOrderBy ?? "salesPriorityScore";
  const orderDir = override?.orderDir ?? settings?.defaultCallingOrderDir ?? undefined;

  const lastContact = await getLastContactDates(eligible.map((c) => c.id));
  const ordered = sortCompaniesForCalling(eligible, orderBy, orderDir, lastContact);

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.callingSession.create({
      data: { listId: list.id, startedById: user.id, orderBy, orderDir: orderDir ?? "desc" },
    });
    await tx.callingSessionEntry.createMany({
      data: ordered.map((company, index) => ({ sessionId: created.id, companyId: company.id, position: index })),
    });
    return created;
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "calling",
    action: "calling_session.started",
    entityType: "CallingSession",
    entityId: session.id,
    metadata: { listId: list.id, companyCount: ordered.length, orderBy, orderDir },
  });

  revalidatePath("/calling-sessions");
  return { success: true, id: session.id };
}

export async function pauseCallingSession(sessionId: string): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");
  const session = await getOwnedSession(user.id, sessionId);
  if (!session || session.status !== "ACTIVE") return;

  await prisma.callingSession.update({ where: { id: sessionId }, data: { status: "PAUSED", pausedAt: new Date() } });
  await writeAuditEvent({ actorId: user.id, module: "calling", action: "calling_session.paused", entityType: "CallingSession", entityId: sessionId });
  revalidatePath(`/calling-sessions/${sessionId}`);
}

export async function resumeCallingSession(sessionId: string): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");
  const session = await getOwnedSession(user.id, sessionId);
  if (!session || session.status !== "PAUSED") return;

  await prisma.callingSession.update({ where: { id: sessionId }, data: { status: "ACTIVE", pausedAt: null } });
  await writeAuditEvent({ actorId: user.id, module: "calling", action: "calling_session.resumed", entityType: "CallingSession", entityId: sessionId });
  revalidatePath(`/calling-sessions/${sessionId}`);
}

export async function endCallingSession(sessionId: string): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");
  const session = await getOwnedSession(user.id, sessionId);
  if (!session || session.status === "COMPLETED" || session.status === "ENDED") return;

  const remaining = await prisma.callingSessionEntry.count({ where: { sessionId, status: "PENDING" } });
  const status = remaining === 0 ? "COMPLETED" : "ENDED";

  await prisma.callingSession.update({ where: { id: sessionId }, data: { status, endedAt: new Date() } });
  await writeAuditEvent({ actorId: user.id, module: "calling", action: "calling_session.completed", entityType: "CallingSession", entityId: sessionId, metadata: { status } });
  revalidatePath(`/calling-sessions/${sessionId}`);
  revalidatePath("/calling-sessions");
}

/** Moves past the current entry without recording anything — it stays
 * PENDING and will be re-offered later this session once every later
 * position has been passed (see nextEntryToOffer). */
export async function skipEntryTemporarily(sessionId: string, entryPosition: number): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");
  const session = await getOwnedSession(user.id, sessionId);
  if (!session || session.status !== "ACTIVE") return;

  const entry = await prisma.callingSessionEntry.findFirst({ where: { sessionId, position: entryPosition } });
  if (!entry || entry.status !== "PENDING") return;

  await prisma.callingSession.update({ where: { id: sessionId }, data: { currentPosition: entryPosition + 1 } });
  revalidatePath(`/calling-sessions/${sessionId}`);
}

export async function goToNextEntryOrSummary(sessionId: string): Promise<never> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");
  const session = await getOwnedSession(user.id, sessionId);
  if (!session) redirect("/calling-sessions");

  const next = await getNextEntry(sessionId);
  if (next) redirect(`/calling-sessions/${sessionId}/${next.id}`);
  redirect(`/calling-sessions/${sessionId}`);
}

/** Marks an entry permanently done for this session with no call outcome
 * recorded — distinct from skipEntryTemporarily (which leaves the entry
 * PENDING and revisitable). No CallRecord/Activity is created; this is for
 * "I'm not calling this one this session" (e.g. wrong time zone), not a
 * completed call. */
export async function skipEntryPermanently(sessionId: string, entryId: string): Promise<void> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");
  const session = await getOwnedSession(user.id, sessionId);
  if (!session || session.status !== "ACTIVE") return;

  const entry = await prisma.callingSessionEntry.findFirst({ where: { id: entryId, sessionId } });
  if (!entry || entry.status !== "PENDING") return;

  await prisma.$transaction([
    prisma.callingSessionEntry.update({ where: { id: entryId }, data: { status: "SKIPPED" } }),
    prisma.callingSession.update({ where: { id: sessionId }, data: { currentPosition: entry.position + 1 } }),
  ]);

  await writeAuditEvent({ actorId: user.id, module: "calling", action: "calling_session.entry_skipped", entityType: "CallingSessionEntry", entityId: entryId });
  revalidatePath(`/calling-sessions/${sessionId}`);
}

export type RecordCallOutcomeResult = { error: string } | { success: true; opensEmailComposer: boolean; companyId: string };

/**
 * The core call-recording action. Idempotency guard: CallRecord.entryId is
 * `@unique` — a retried submit (double-click, network retry) for an entry
 * that already has a CallRecord returns the existing outcome rather than
 * creating a second Activity/Task, satisfying the spec's "prevent duplicate
 * activity creation if a request is retried" requirement.
 */
export async function recordCallOutcome(
  sessionId: string,
  entryId: string,
  input: { outcomeId: string; notes: string; rejectionReasonId?: string },
): Promise<RecordCallOutcomeResult> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");

  const session = await getOwnedSession(user.id, sessionId);
  if (!session) return { error: "Session not found." };
  if (session.status !== "ACTIVE") return { error: "This session is not active — resume it first." };

  const entry = await prisma.callingSessionEntry.findFirst({ where: { id: entryId, sessionId } });
  if (!entry) return { error: "This company is not part of this session." };

  // Idempotency: a request retried after the first one already succeeded
  // finds the existing record and returns success again, rather than
  // erroring or duplicating anything.
  const existingRecord = await prisma.callRecord.findUnique({ where: { entryId } });
  if (existingRecord) {
    const outcome = await prisma.callOutcome.findUniqueOrThrow({ where: { id: existingRecord.outcomeId } });
    return { success: true, opensEmailComposer: outcome.opensEmailComposer, companyId: existingRecord.companyId };
  }
  if (entry.status !== "PENDING") return { error: "This company has already been handled this session." };

  const outcome = await prisma.callOutcome.findFirst({ where: { id: input.outcomeId, active: true } });
  if (!outcome) return { error: "Choose a valid call outcome." };
  if (outcome.requiresNotes && !input.notes.trim()) return { error: "Notes are required for this outcome." };
  if (outcome.requiresRejectionReason && !input.rejectionReasonId) return { error: "Choose a reason for this outcome." };

  const scope = companyScope(user);
  if (!scope) return { error: "You do not have access to this company." };
  const company = await prisma.company.findFirst({ where: { id: entry.companyId, ...scope } });
  if (!company) return { error: "You do not have access to this company." };

  const notes = input.notes.trim() || null;
  const canChangeStage = outcome.defaultPipelineStageId && hasPermission(user, "edit_leads");

  await prisma.$transaction(async (tx) => {
    const activity = await logCallActivity(tx, { companyId: company.id, userId: user.id, outcomeName: outcome.name, notes });

    let taskId: string | null = null;
    if (outcome.requiresNextAction && outcome.defaultNextActionDays !== null) {
      const dueAt = new Date(Date.now() + outcome.defaultNextActionDays * 24 * 60 * 60 * 1000);
      const task = await tx.task.create({
        data: {
          companyId: company.id,
          assignedToId: company.assignedToId ?? user.id,
          title: outcome.defaultNextActionTitle ?? outcome.name,
          dueAt,
        },
      });
      taskId = task.id;
    }

    if (canChangeStage && outcome.defaultPipelineStageId && outcome.defaultPipelineStageId !== company.pipelineStageId) {
      await logPipelineChange(tx, {
        companyId: company.id,
        userId: user.id,
        fromStageId: company.pipelineStageId,
        toStageId: outcome.defaultPipelineStageId,
        lossReasonId: input.rejectionReasonId ?? null,
      });
      await tx.company.update({ where: { id: company.id }, data: { pipelineStageId: outcome.defaultPipelineStageId } });
    }

    if (outcome.appliesDoNotContact) {
      await tx.company.update({ where: { id: company.id }, data: { doNotContact: true } });
    }

    await tx.callRecord.create({
      data: {
        sessionId,
        entryId,
        companyId: company.id,
        outcomeId: outcome.id,
        notes,
        recordedById: user.id,
        activityId: activity.id,
        taskId,
        appliedPipelineStageId: canChangeStage ? outcome.defaultPipelineStageId : null,
        rejectionReasonId: input.rejectionReasonId ?? null,
      },
    });

    await tx.callingSessionEntry.update({ where: { id: entryId }, data: { status: "COMPLETED" } });
    await tx.callingSession.update({ where: { id: sessionId }, data: { currentPosition: entry.position + 1 } });
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "calling",
    action: "call_outcome.recorded",
    entityType: "Company",
    entityId: company.id,
    metadata: { sessionId, entryId, outcomeId: outcome.id, outcomeName: outcome.name },
  });

  revalidatePath(`/calling-sessions/${sessionId}`);
  revalidatePath(`/companies/${company.id}`);
  return { success: true, opensEmailComposer: outcome.opensEmailComposer, companyId: company.id };
}

/**
 * Lets the salesperson fix a note on an already-completed entry, still
 * within the same active session — the "revisit a completed entry"
 * capability CallOutcome.skipRestOfSession exists to gate (see the field's
 * schema comment). Only ever touches CallRecord.notes and the linked
 * Activity's notes (kept in sync, since the Activity is the CRM-visible
 * record on the company's timeline) — never re-fires the outcome's other
 * side effects (task creation, pipeline-stage change, do-not-contact),
 * which already ran once when the call was first recorded.
 */
export async function updateCallRecordNotes(sessionId: string, entryId: string, notes: string): Promise<{ error: string } | { success: true }> {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");

  const session = await getOwnedSession(user.id, sessionId);
  if (!session || session.status !== "ACTIVE") return { error: "This session is not active — resume it first." };

  const entry = await prisma.callingSessionEntry.findFirst({ where: { id: entryId, sessionId, status: "COMPLETED" } });
  if (!entry) return { error: "This company is not a completed entry in this session." };

  const callRecord = await prisma.callRecord.findUnique({ where: { entryId }, include: { outcome: true } });
  if (!callRecord) return { error: "No call record found for this entry." };
  if (callRecord.outcome.skipRestOfSession) return { error: "This outcome cannot be revisited." };

  const trimmed = notes.trim() || null;
  if (callRecord.outcome.requiresNotes && !trimmed) return { error: "Notes are required for this outcome." };

  await prisma.$transaction(async (tx) => {
    await tx.callRecord.update({ where: { id: callRecord.id }, data: { notes: trimmed } });
    if (callRecord.activityId) {
      await tx.activity.update({ where: { id: callRecord.activityId }, data: { notes: trimmed } });
    }
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "calling",
    action: "call_outcome.notes_revised",
    entityType: "Company",
    entityId: callRecord.companyId,
    metadata: { sessionId, entryId },
  });

  revalidatePath(`/calling-sessions/${sessionId}`);
  return { success: true };
}
