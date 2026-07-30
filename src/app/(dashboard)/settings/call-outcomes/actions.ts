"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";
import type { Prisma } from "@/generated/prisma/client";
import type { CallOutcomeResultCategory } from "@/generated/prisma/enums";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/call-outcomes";

async function requireCallOutcomeManager() {
  const user = await requireUser();
  requirePermission(user, "manage_call_outcomes");
  return user;
}

export async function createCallOutcome(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireCallOutcomeManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.callOutcome.aggregate({ _max: { sortOrder: true } });

  try {
    await prisma.callOutcome.create({ data: { name: parsed.data.name, sortOrder: (highest._max.sortOrder ?? -1) + 1 } });
  } catch {
    return { error: "A call outcome with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function renameCallOutcome(id: string, formData: FormData): Promise<ActionResult> {
  await requireCallOutcomeManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  try {
    await prisma.callOutcome.update({ where: { id }, data: { name: parsed.data.name } });
  } catch {
    return { error: "A call outcome with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function setCallOutcomeActive(id: string, active: boolean): Promise<void> {
  await requireCallOutcomeManager();
  await prisma.callOutcome.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function moveCallOutcome(id: string, direction: "up" | "down"): Promise<void> {
  await requireCallOutcomeManager();

  const items = await prisma.callOutcome.findMany({ orderBy: { sortOrder: "asc" } });
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= items.length) return;

  const current = items[index];
  const swap = items[swapIndex];

  await prisma.$transaction([
    prisma.callOutcome.update({ where: { id: current.id }, data: { sortOrder: swap.sortOrder } }),
    prisma.callOutcome.update({ where: { id: swap.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  revalidatePath(PATH);
}

/** Never actually deletes an outcome referenced by any CallRecord — per the
 * spec's "Do not delete outcomes that are referenced by history. Deactivate
 * them instead," matching RejectionReason's exact precedent. */
export async function deleteCallOutcome(id: string): Promise<ActionResult> {
  await requireCallOutcomeManager();

  const usageCount = await prisma.callRecord.count({ where: { outcomeId: id } });
  if (usageCount > 0) {
    return { error: "This call outcome has been used to record calls — deactivate it instead of deleting." };
  }

  await prisma.callOutcome.delete({ where: { id } });
  revalidatePath(PATH);
}

export async function updateCallOutcomeConfig(id: string, formData: FormData): Promise<ActionResult> {
  await requireCallOutcomeManager();

  const requiresNextAction = formData.get("requiresNextAction") === "on";
  const defaultNextActionDaysRaw = formString(formData, "defaultNextActionDays");
  const defaultNextActionDays = requiresNextAction && defaultNextActionDaysRaw ? Number(defaultNextActionDaysRaw) : null;
  if (requiresNextAction && (defaultNextActionDays === null || !Number.isInteger(defaultNextActionDays) || defaultNextActionDays < 0)) {
    return { error: "Enter how many days from now the default follow-up should be due." };
  }

  const resultCategoryRaw = formString(formData, "resultCategory");
  const resultCategory = resultCategoryRaw ? (resultCategoryRaw as CallOutcomeResultCategory) : null;

  const data: Prisma.CallOutcomeUpdateInput = {
    requiresNotes: formData.get("requiresNotes") === "on",
    requiresNextAction,
    defaultNextActionDays,
    defaultNextActionTitle: requiresNextAction ? formString(formData, "defaultNextActionTitle") || null : null,
    opensEmailComposer: formData.get("opensEmailComposer") === "on",
    requiresRejectionReason: formData.get("requiresRejectionReason") === "on",
    skipRestOfSession: formData.get("skipRestOfSession") === "on",
    appliesDoNotContact: formData.get("appliesDoNotContact") === "on",
    resultCategory,
  };

  const defaultPipelineStageId = formString(formData, "defaultPipelineStageId");
  data.defaultPipelineStage = defaultPipelineStageId ? { connect: { id: defaultPipelineStageId } } : { disconnect: true };

  await prisma.callOutcome.update({ where: { id }, data });
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${id}`);
}
