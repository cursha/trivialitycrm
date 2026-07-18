"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/pipeline-stages";

async function requireSettingsManager() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");
  return user;
}

export async function createPipelineStage(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSettingsManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.pipelineStage.aggregate({ _max: { sortOrder: true } });
  const isFirstStage = (await prisma.pipelineStage.count()) === 0;

  try {
    await prisma.pipelineStage.create({
      data: {
        name: parsed.data.name,
        sortOrder: (highest._max.sortOrder ?? -1) + 1,
        // The very first stage ever created has to be the default, since
        // exactly one stage must always be marked default.
        isDefault: isFirstStage,
      },
    });
  } catch {
    return { error: "A pipeline stage with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function renamePipelineStage(id: string, formData: FormData): Promise<ActionResult> {
  await requireSettingsManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  try {
    await prisma.pipelineStage.update({ where: { id }, data: { name: parsed.data.name } });
  } catch {
    return { error: "A pipeline stage with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function setPipelineStageActive(id: string, active: boolean): Promise<void> {
  await requireSettingsManager();

  const stage = await prisma.pipelineStage.findUnique({ where: { id } });
  if (!stage) return;

  // The default stage must always be usable — don't allow deactivating it.
  if (!active && stage.isDefault) return;

  await prisma.pipelineStage.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function setDefaultPipelineStage(id: string): Promise<void> {
  await requireSettingsManager();

  await prisma.$transaction([
    prisma.pipelineStage.updateMany({ data: { isDefault: false }, where: { NOT: { id } } }),
    prisma.pipelineStage.update({ where: { id }, data: { isDefault: true, active: true } }),
  ]);

  revalidatePath(PATH);
}

export async function movePipelineStage(id: string, direction: "up" | "down"): Promise<void> {
  await requireSettingsManager();

  const items = await prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } });
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= items.length) return;

  const current = items[index];
  const swap = items[swapIndex];

  await prisma.$transaction([
    prisma.pipelineStage.update({ where: { id: current.id }, data: { sortOrder: swap.sortOrder } }),
    prisma.pipelineStage.update({ where: { id: swap.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  revalidatePath(PATH);
}

export async function deletePipelineStage(id: string): Promise<ActionResult> {
  await requireSettingsManager();

  const stage = await prisma.pipelineStage.findUnique({ where: { id } });
  if (stage?.isDefault) {
    return { error: "Choose a different default stage before deleting this one." };
  }

  const usageCount = await prisma.company.count({ where: { pipelineStageId: id } });
  if (usageCount > 0) {
    return { error: "This stage is used by existing companies — deactivate it instead of deleting." };
  }

  await prisma.pipelineStage.delete({ where: { id } });
  revalidatePath(PATH);
}
