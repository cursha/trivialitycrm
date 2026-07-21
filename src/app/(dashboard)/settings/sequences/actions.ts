"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/sequences";
const STEP_TYPES = ["WAIT", "EMAIL", "TASK", "CALL_REMINDER", "DEMO_REMINDER", "TRIAL_FOLLOWUP"] as const;
type StepType = (typeof STEP_TYPES)[number];

async function requireSequenceManager() {
  const user = await requireUser();
  requirePermission(user, "manage_sequences");
  return user;
}

/** Steps can only be added/edited/removed/reordered while nobody has ever
 * been enrolled — changing the recipe out from under an active enrollment
 * would leave its currentStepOrder pointer meaningless. Once a sequence has
 * at least one enrollment (active or historical), its step list is locked;
 * deactivate it and create a new sequence instead. */
async function assertStepsEditable(sequenceId: string): Promise<string | null> {
  const enrollmentCount = await prisma.sequenceEnrollment.count({ where: { sequenceId } });
  if (enrollmentCount > 0) {
    return "This sequence has already been enrolled — its steps are locked. Deactivate it and create a new sequence instead.";
  }
  return null;
}

export async function createSequence(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireSequenceManager();

  const name = formString(formData, "name").trim();
  if (!name) return { error: "Enter a name for this sequence." };
  const stopOnPipelineStageId = formString(formData, "stopOnPipelineStageId").trim() || null;

  await prisma.followUpSequence.create({ data: { name, stopOnPipelineStageId, createdById: user.id } });
  revalidatePath(PATH);
}

export async function setSequenceActive(id: string, active: boolean): Promise<void> {
  await requireSequenceManager();
  await prisma.followUpSequence.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function addSequenceStep(sequenceId: string, _prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSequenceManager();

  const lockError = await assertStepsEditable(sequenceId);
  if (lockError) return { error: lockError };

  const type = formString(formData, "type");
  if (!STEP_TYPES.includes(type as StepType)) return { error: "Choose a step type." };

  const waitDays = type === "WAIT" ? Number(formString(formData, "waitDays")) : null;
  if (type === "WAIT" && (!Number.isInteger(waitDays) || (waitDays as number) < 1)) {
    return { error: "Enter a whole number of days (1 or more) to wait." };
  }

  const emailTemplateId = type === "EMAIL" ? formString(formData, "emailTemplateId").trim() : null;
  if (type === "EMAIL") {
    if (!emailTemplateId) return { error: "Choose a shared template for this email step." };
    const template = await prisma.emailTemplate.findUnique({ where: { id: emailTemplateId } });
    if (!template || template.visibility !== "SHARED" || !template.active) {
      return { error: "Choose an active, shared template — personal templates can't be used in a sequence." };
    }
  }

  const taskTitle = ["TASK", "CALL_REMINDER", "DEMO_REMINDER", "TRIAL_FOLLOWUP"].includes(type)
    ? formString(formData, "taskTitle").trim() || null
    : null;
  const taskNotes = ["TASK", "CALL_REMINDER", "DEMO_REMINDER", "TRIAL_FOLLOWUP"].includes(type)
    ? formString(formData, "taskNotes").trim() || null
    : null;

  const highest = await prisma.sequenceStep.aggregate({ where: { sequenceId }, _max: { stepOrder: true } });

  await prisma.sequenceStep.create({
    data: {
      sequenceId,
      stepOrder: (highest._max.stepOrder ?? 0) + 1,
      type: type as StepType,
      waitDays,
      emailTemplateId,
      taskTitle,
      taskNotes,
    },
  });

  revalidatePath(`${PATH}/${sequenceId}/edit`);
}

export async function deleteSequenceStep(sequenceId: string, stepId: string): Promise<ActionResult> {
  await requireSequenceManager();
  const lockError = await assertStepsEditable(sequenceId);
  if (lockError) return { error: lockError };

  await prisma.sequenceStep.delete({ where: { id: stepId } });
  revalidatePath(`${PATH}/${sequenceId}/edit`);
}

export async function moveSequenceStep(sequenceId: string, stepId: string, direction: "up" | "down"): Promise<ActionResult> {
  await requireSequenceManager();
  const lockError = await assertStepsEditable(sequenceId);
  if (lockError) return { error: lockError };

  const steps = await prisma.sequenceStep.findMany({ where: { sequenceId }, orderBy: { stepOrder: "asc" } });
  const index = steps.findIndex((s) => s.id === stepId);
  if (index === -1) return { error: "Step not found." };

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= steps.length) return;

  const current = steps[index];
  const swap = steps[swapIndex];

  await prisma.$transaction([
    prisma.sequenceStep.update({ where: { id: current.id }, data: { stepOrder: swap.stepOrder } }),
    prisma.sequenceStep.update({ where: { id: swap.id }, data: { stepOrder: current.stepOrder } }),
  ]);

  revalidatePath(`${PATH}/${sequenceId}/edit`);
}
