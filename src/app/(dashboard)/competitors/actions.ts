"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { CompetitorSchema } from "@/lib/validation/competitor";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/competitors";

async function requireCompetitorManager() {
  const user = await requireUser();
  requirePermission(user, "manage_competitors");
  return user;
}

function parseCompetitorForm(formData: FormData) {
  return CompetitorSchema.safeParse({
    name: formString(formData, "name"),
    websiteUrl: formString(formData, "websiteUrl"),
  });
}

export async function createCompetitor(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireCompetitorManager();

  const parsed = parseCompetitorForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  try {
    await prisma.competitor.create({
      data: { name: parsed.data.name, websiteUrl: parsed.data.websiteUrl || null },
    });
  } catch {
    return { error: "A competitor with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function updateCompetitor(id: string, formData: FormData): Promise<ActionResult> {
  await requireCompetitorManager();

  const parsed = parseCompetitorForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  try {
    await prisma.competitor.update({
      where: { id },
      data: { name: parsed.data.name, websiteUrl: parsed.data.websiteUrl || null },
    });
  } catch {
    return { error: "A competitor with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function setCompetitorActive(id: string, active: boolean): Promise<void> {
  await requireCompetitorManager();
  await prisma.competitor.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function deleteCompetitor(id: string): Promise<ActionResult> {
  await requireCompetitorManager();

  const usageCount = await prisma.company.count({ where: { competitorId: id } });
  if (usageCount > 0) {
    return { error: "This competitor is linked to existing companies — deactivate it instead of deleting." };
  }

  await prisma.competitor.delete({ where: { id } });
  revalidatePath(PATH);
}
