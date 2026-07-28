"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";
import { sanitizeRoutePlanSlug } from "@/lib/route-plan/validation";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/lead-types";

async function requireSettingsManager() {
  const user = await requireUser();
  requirePermission(user, "manage_settings");
  return user;
}

/**
 * Deliberately gated by configure_route_plan_lead_types, not
 * manage_settings — deciding Route Plan eligibility is its own permission
 * (spec: "Administrators control which roles have Route Plan permission" /
 * "Administrators mark which lead types are eligible"), granted
 * Administrator-only by default but independently admin-adjustable like
 * every other permission, not hardwired to the general settings-manager
 * permission this file's other actions use.
 */
export async function setLeadTypeRoutePlanSettings(id: string, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "configure_route_plan_lead_types");

  const enabled = formData.get("routePlanEnabled") === "on";
  const rawSlug = formString(formData, "routePlanSlug");
  const slug = enabled ? sanitizeRoutePlanSlug(rawSlug) : null;

  if (enabled && !slug) {
    return { error: "Enter a filename slug (letters, numbers, and hyphens) to enable Route Planning for this lead type." };
  }

  try {
    await prisma.leadType.update({ where: { id }, data: { routePlanEnabled: enabled, routePlanSlug: slug } });
  } catch {
    return { error: "That filename slug is already used by another lead type." };
  }

  revalidatePath(PATH);
}

export async function createLeadType(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSettingsManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.leadType.aggregate({ _max: { sortOrder: true } });

  try {
    await prisma.leadType.create({
      data: { name: parsed.data.name, sortOrder: (highest._max.sortOrder ?? -1) + 1 },
    });
  } catch {
    return { error: "A lead type with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function renameLeadType(id: string, formData: FormData): Promise<ActionResult> {
  await requireSettingsManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  try {
    await prisma.leadType.update({ where: { id }, data: { name: parsed.data.name } });
  } catch {
    return { error: "A lead type with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function setLeadTypeActive(id: string, active: boolean): Promise<void> {
  await requireSettingsManager();
  await prisma.leadType.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function moveLeadType(id: string, direction: "up" | "down"): Promise<void> {
  await requireSettingsManager();

  const items = await prisma.leadType.findMany({ orderBy: { sortOrder: "asc" } });
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return;

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= items.length) return;

  const current = items[index];
  const swap = items[swapIndex];

  await prisma.$transaction([
    prisma.leadType.update({ where: { id: current.id }, data: { sortOrder: swap.sortOrder } }),
    prisma.leadType.update({ where: { id: swap.id }, data: { sortOrder: current.sortOrder } }),
  ]);

  revalidatePath(PATH);
}

export async function deleteLeadType(id: string): Promise<ActionResult> {
  await requireSettingsManager();

  const usageCount = await prisma.company.count({ where: { leadTypeId: id } });
  if (usageCount > 0) {
    return { error: "This lead type is used by existing companies — deactivate it instead of deleting." };
  }

  await prisma.leadType.delete({ where: { id } });
  revalidatePath(PATH);
}
