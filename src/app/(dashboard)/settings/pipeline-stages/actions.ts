"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";
import { PipelineStageOutcome } from "@/generated/prisma/enums";

/** Form value is "" (open, the default) | "WON" | "LOST" — anything else is
 * a malformed request, not a real user choice, so it's rejected rather than
 * silently coerced to open. */
function parseOutcomeType(value: string): { ok: true; value: PipelineStageOutcome | null } | { ok: false } {
  if (value === "") return { ok: true, value: null };
  if (value === PipelineStageOutcome.WON || value === PipelineStageOutcome.LOST) return { ok: true, value };
  return { ok: false };
}

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

  const outcome = parseOutcomeType(formString(formData, "outcomeType"));
  if (!outcome.ok) {
    return { error: "Choose a valid outcome." };
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
        outcomeType: outcome.value,
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

/**
 * Marks a stage as Won, Lost, or open (null) — drives next-best-action,
 * priority scoring, and pipeline/trend reporting (see PipelineStageOutcome
 * usages across src/lib/workspace and src/app/(dashboard)/reports), all of
 * which previously had no admin-facing way to configure this at all: every
 * stage was permanently outcomeType: null from creation onward.
 */
export async function setPipelineStageOutcome(id: string, outcomeType: PipelineStageOutcome | null): Promise<void> {
  await requireSettingsManager();

  await prisma.pipelineStage.update({ where: { id }, data: { outcomeType } });
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
