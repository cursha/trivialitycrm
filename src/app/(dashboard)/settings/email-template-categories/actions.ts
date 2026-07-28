"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/email-template-categories";

// Mirrors template management's own gate (spec: "only administrators
// create/edit/... templates") rather than the generic manage_settings —
// categories are part of the shared-template admin surface, not general
// workspace settings.
async function requireCategoryManager() {
  const user = await requireUser();
  requirePermission(user, "manage_shared_templates");
  return user;
}

export async function createEmailTemplateCategory(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireCategoryManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.emailTemplateCategory.aggregate({ _max: { sortOrder: true } });

  try {
    await prisma.emailTemplateCategory.create({
      data: { name: parsed.data.name, sortOrder: (highest._max.sortOrder ?? -1) + 1, createdById: user.id },
    });
  } catch {
    return { error: "A category with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function renameEmailTemplateCategory(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireCategoryManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  try {
    await prisma.emailTemplateCategory.update({ where: { id }, data: { name: parsed.data.name, updatedById: user.id } });
  } catch {
    return { error: "A category with that name already exists." };
  }

  revalidatePath(PATH);
  revalidatePath("/settings/email-templates");
}

export async function setEmailTemplateCategoryActive(id: string, active: boolean): Promise<void> {
  const user = await requireCategoryManager();
  await prisma.emailTemplateCategory.update({ where: { id }, data: { active, updatedById: user.id } });
  revalidatePath(PATH);
  revalidatePath("/settings/email-templates");
}

export async function moveEmailTemplateCategory(id: string, direction: "up" | "down"): Promise<void> {
  await requireCategoryManager();

  const items = await prisma.emailTemplateCategory.findMany({ orderBy: { sortOrder: "asc" } });
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= items.length) return;

  const current = items[index];
  const swap = items[swapIndex];

  await prisma.$transaction([
    prisma.emailTemplateCategory.update({ where: { id: current.id }, data: { sortOrder: swap.sortOrder } }),
    prisma.emailTemplateCategory.update({ where: { id: swap.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  revalidatePath(PATH);
}

export async function deleteEmailTemplateCategory(id: string): Promise<ActionResult> {
  await requireCategoryManager();

  const usageCount = await prisma.emailTemplate.count({ where: { categoryId: id } });
  if (usageCount > 0) {
    return { error: "This category is used by existing templates — deactivate it instead of deleting." };
  }

  await prisma.emailTemplateCategory.delete({ where: { id } });
  revalidatePath(PATH);
}
