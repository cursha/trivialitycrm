"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/rejection-reasons";

async function requireSettingsManager() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");
  return user;
}

export async function createRejectionReason(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSettingsManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.rejectionReason.aggregate({ _max: { sortOrder: true } });

  try {
    await prisma.rejectionReason.create({
      data: { name: parsed.data.name, sortOrder: (highest._max.sortOrder ?? -1) + 1 },
    });
  } catch {
    return { error: "A rejection reason with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function renameRejectionReason(id: string, formData: FormData): Promise<ActionResult> {
  await requireSettingsManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  try {
    await prisma.rejectionReason.update({ where: { id }, data: { name: parsed.data.name } });
  } catch {
    return { error: "A rejection reason with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function setRejectionReasonActive(id: string, active: boolean): Promise<void> {
  await requireSettingsManager();
  await prisma.rejectionReason.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function moveRejectionReason(id: string, direction: "up" | "down"): Promise<void> {
  await requireSettingsManager();

  const items = await prisma.rejectionReason.findMany({ orderBy: { sortOrder: "asc" } });
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= items.length) return;

  const current = items[index];
  const swap = items[swapIndex];

  await prisma.$transaction([
    prisma.rejectionReason.update({ where: { id: current.id }, data: { sortOrder: swap.sortOrder } }),
    prisma.rejectionReason.update({ where: { id: swap.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  revalidatePath(PATH);
}

export async function deleteRejectionReason(id: string): Promise<ActionResult> {
  await requireSettingsManager();

  const usageCount = await prisma.searchResult.count({ where: { rejectionReasonId: id } });
  if (usageCount > 0) {
    return { error: "This rejection reason has been used on existing research results — deactivate it instead of deleting." };
  }

  await prisma.rejectionReason.delete({ where: { id } });
  revalidatePath(PATH);
}
