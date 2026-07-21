// No `import "server-only"` — the sequence-tick/run-sequence-step worker
// handlers need every function here; same reasoning as every other
// Module Six comms module the worker consumes.
import { prisma } from "@/lib/prisma";
import type { SequenceStepType } from "@/generated/prisma/client";
import { sendEmail } from "@/lib/comms/send-email";

export type StepLike = { id: string; stepOrder: number; type: SequenceStepType; waitDays: number | null };

const DEFAULT_TASK_TITLES: Record<string, string> = {
  TASK: "Follow up",
  CALL_REMINDER: "Call reminder",
  DEMO_REMINDER: "Demo reminder",
  TRIAL_FOLLOWUP: "Trial follow-up",
};

/**
 * WAIT steps have no side effect of their own — they only delay how long
 * after the previous actionable step the next one becomes due. Given a
 * step list and a starting order (exclusive), returns the next actionable
 * (non-WAIT) step plus the number of days to wait before it's due,
 * folding in every WAIT step encountered along the way. Returns null once
 * there are no more steps — the caller should mark the enrollment
 * COMPLETED in that case.
 */
export function nextActionableStep(steps: StepLike[], afterOrder: number): { step: StepLike; waitDays: number } | null {
  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  let waitDays = 0;
  for (const step of sorted) {
    if (step.stepOrder <= afterOrder) continue;
    if (step.type === "WAIT") {
      waitDays += step.waitDays ?? 0;
      continue;
    }
    return { step, waitDays };
  }
  return null;
}

/** The first actionable step from the very start of the sequence (order 0,
 * exclusive) — used at enrollment time. */
export function firstActionableStep(steps: StepLike[]): { step: StepLike; waitDays: number } | null {
  return nextActionableStep(steps, 0);
}

export type StepPreviewEntry = {
  stepOrder: number;
  type: SequenceStepType;
  label: string;
  /** Days from enrollment until this step would run, assuming no pauses. */
  cumulativeDays: number;
};

/**
 * Every step in order, including WAIT — "show every step before
 * enrollment" per the approved plan. `cumulativeDays` lets the enrollment
 * UI show "Day 0: send X", "Day 3: call reminder", etc.
 */
export function previewSteps(
  steps: StepLike[],
  templateNames: Record<string, string> = {},
): StepPreviewEntry[] {
  const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  let cumulativeDays = 0;
  const entries: StepPreviewEntry[] = [];

  for (const step of sorted) {
    if (step.type === "WAIT") {
      cumulativeDays += step.waitDays ?? 0;
      entries.push({ stepOrder: step.stepOrder, type: step.type, label: `Wait ${step.waitDays ?? 0} day(s)`, cumulativeDays });
      continue;
    }
    const label =
      step.type === "EMAIL"
        ? `Send email: ${templateNames[step.id] ?? "(template)"}`
        : DEFAULT_TASK_TITLES[step.type] ?? step.type;
    entries.push({ stepOrder: step.stepOrder, type: step.type, label, cumulativeDays });
  }
  return entries;
}

export type EnrollOutcome = { ok: true; enrollmentId: string } | { ok: false; error: string };

/**
 * Explicit enrollment only — the only way a SequenceEnrollment row is ever
 * created. Requires a contact when the sequence contains any EMAIL step
 * (an EMAIL step needs a Contact to check consent against, exactly like
 * every other send path in this module).
 */
export async function enrollInSequence(params: {
  sequenceId: string;
  companyId: string;
  contactId?: string | null;
  enrolledById: string;
}): Promise<EnrollOutcome> {
  const sequence = await prisma.followUpSequence.findUnique({
    where: { id: params.sequenceId },
    include: { steps: true },
  });
  if (!sequence || !sequence.active) {
    return { ok: false, error: "This sequence is not available." };
  }

  const hasEmailStep = sequence.steps.some((step) => step.type === "EMAIL");
  if (hasEmailStep && !params.contactId) {
    return { ok: false, error: "This sequence sends email — choose a contact when enrolling." };
  }

  const existing = await prisma.sequenceEnrollment.findFirst({
    where: { sequenceId: params.sequenceId, companyId: params.companyId, status: { in: ["ACTIVE", "PAUSED"] } },
  });
  if (existing) {
    return { ok: false, error: "This company is already enrolled in this sequence." };
  }

  const first = firstActionableStep(sequence.steps);
  if (!first) {
    return { ok: false, error: "This sequence has no actionable steps to run." };
  }

  const enrollment = await prisma.sequenceEnrollment.create({
    data: {
      sequenceId: params.sequenceId,
      companyId: params.companyId,
      contactId: params.contactId ?? null,
      enrolledById: params.enrolledById,
      currentStepOrder: first.step.stepOrder,
      nextStepDueAt: addDays(new Date(), first.waitDays),
    },
  });

  return { ok: true, enrollmentId: enrollment.id };
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Runs the one step (`stepId`) due for `enrollmentId` — called by the
 * run-sequence-step worker job. Re-checks stop conditions fresh (never
 * trusted from enrollment or tick time): a contact who opted out, or a
 * company that reached the sequence's stop stage, ends the enrollment
 * instead of running the step. A no-op if the enrollment isn't ACTIVE or
 * the step no longer matches `currentStepOrder` — both are safe outcomes
 * of a race (paused/cancelled between tick and job, or already advanced by
 * an overlapping job), not errors.
 */
export async function processDueSequenceStep(enrollmentId: string, stepId: string): Promise<void> {
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { sequence: { include: { steps: true } }, company: true, contact: true },
  });
  if (!enrollment || enrollment.status !== "ACTIVE") return;

  const step = enrollment.sequence.steps.find((s) => s.id === stepId);
  if (!step || step.stepOrder !== enrollment.currentStepOrder) return;

  if (enrollment.contact?.doNotContact) {
    await stopEnrollment(enrollment.id, "STOPPED_OPT_OUT", "The linked contact has opted out of email.");
    return;
  }
  if (enrollment.sequence.stopOnPipelineStageId && enrollment.company.pipelineStageId === enrollment.sequence.stopOnPipelineStageId) {
    await stopEnrollment(enrollment.id, "STOPPED_STAGE", "The company reached this sequence's stop stage.");
    return;
  }

  const alreadyRun = await prisma.sequenceStepRun.findUnique({ where: { enrollmentId_stepId: { enrollmentId, stepId } } });
  if (alreadyRun) return;

  let runStatus: "SUCCEEDED" | "FAILED" = "SUCCEEDED";
  let errorMessage: string | null = null;
  let emailMessageId: string | null = null;

  if (step.type === "EMAIL") {
    if (!enrollment.contactId || !step.emailTemplateId) {
      runStatus = "FAILED";
      errorMessage = "This step has no contact or template to send.";
    } else {
      const template = await prisma.emailTemplate.findUnique({ where: { id: step.emailTemplateId } });
      if (!template) {
        runStatus = "FAILED";
        errorMessage = "The template for this step no longer exists.";
      } else if (!template.active) {
        runStatus = "FAILED";
        errorMessage = "The template for this step has been deactivated.";
      } else {
        const result = await sendEmail({
          userId: enrollment.enrolledById,
          companyId: enrollment.companyId,
          contactId: enrollment.contactId,
          templateId: template.id,
          subject: template.subject,
          body: template.body,
          // sequences.ts sends its own unified failure notification below
          // (covering both a gate rejection and a delivery failure) —
          // sendEmail()'s built-in one would otherwise double up.
          notifyOnFailure: false,
        });
        if (result.ok) {
          emailMessageId = result.emailMessageId;
        } else {
          runStatus = "FAILED";
          errorMessage = result.error;
        }
      }
    }
  } else if (step.type !== "WAIT") {
    await prisma.task.create({
      data: {
        companyId: enrollment.companyId,
        assignedToId: enrollment.company.assignedToId ?? enrollment.enrolledById,
        title: step.taskTitle ?? DEFAULT_TASK_TITLES[step.type] ?? step.type,
        notes: step.taskNotes,
        dueAt: new Date(),
      },
    });
  }

  try {
    await prisma.sequenceStepRun.create({
      data: { enrollmentId, stepId, status: runStatus, errorMessage, emailMessageId },
    });
  } catch {
    // Unique-constraint race with another job for the same step — the
    // other job already recorded this run; nothing more to do here.
    return;
  }

  // A failed step doesn't stop the sequence (a one-off provider hiccup
  // shouldn't kill an otherwise-healthy campaign) — but it must never fail
  // *silently*: the enroller gets a notification on top of the
  // SequenceStepRun row, same as any other delivery failure in this app.
  if (runStatus === "FAILED") {
    await prisma.notification.create({
      data: {
        userId: enrollment.enrolledById,
        type: "DELIVERY_FAILURE",
        payload: { enrollmentId, stepId, sequenceId: enrollment.sequenceId, error: errorMessage },
      },
    });
  }

  const next = nextActionableStep(enrollment.sequence.steps, step.stepOrder);
  if (!next) {
    await prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: "COMPLETED", stoppedAt: new Date(), nextStepDueAt: null },
    });
    await prisma.notification.create({
      data: { userId: enrollment.enrolledById, type: "SEQUENCE_COMPLETED", payload: { enrollmentId, sequenceId: enrollment.sequenceId } },
    });
    return;
  }

  await prisma.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data: { currentStepOrder: next.step.stepOrder, nextStepDueAt: addDays(new Date(), next.waitDays) },
  });
}

async function stopEnrollment(enrollmentId: string, status: "STOPPED_OPT_OUT" | "STOPPED_STAGE", reason: string): Promise<void> {
  const enrollment = await prisma.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data: { status, stoppedAt: new Date(), stopReason: reason, nextStepDueAt: null },
  });
  await prisma.notification.create({
    data: { userId: enrollment.enrolledById, type: "SEQUENCE_PAUSED", payload: { enrollmentId, reason } },
  });
}

export async function pauseEnrollment(enrollmentId: string): Promise<void> {
  await prisma.sequenceEnrollment.updateMany({ where: { id: enrollmentId, status: "ACTIVE" }, data: { status: "PAUSED" } });
}

export async function resumeEnrollment(enrollmentId: string): Promise<void> {
  await prisma.sequenceEnrollment.updateMany({ where: { id: enrollmentId, status: "PAUSED" }, data: { status: "ACTIVE" } });
}

export async function cancelEnrollment(enrollmentId: string): Promise<void> {
  await prisma.sequenceEnrollment.updateMany({
    where: { id: enrollmentId, status: { in: ["ACTIVE", "PAUSED"] } },
    data: { status: "CANCELLED", stoppedAt: new Date() },
  });
}
