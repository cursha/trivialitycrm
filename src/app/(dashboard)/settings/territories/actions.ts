"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { TerritorySchema } from "@/lib/validation/territory";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/territories";

async function requireTerritoryManager() {
  const user = await requireUser();
  requirePermission(user, "manage_territories");
  return user;
}

function parseTerritoryForm(formData: FormData) {
  return TerritorySchema.safeParse({
    name: formString(formData, "name"),
    country: formString(formData, "country"),
    region: formString(formData, "region"),
    city: formString(formData, "city"),
    assignedToId: formString(formData, "assignedToId"),
  });
}

export async function createTerritory(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireTerritoryManager();

  const parsed = parseTerritoryForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  try {
    await prisma.territory.create({
      data: {
        name: parsed.data.name ?? null,
        country: parsed.data.country,
        region: parsed.data.region ?? null,
        city: parsed.data.city ?? null,
        assignedToId: parsed.data.assignedToId ?? null,
      },
    });
  } catch {
    return { error: "A territory with that exact country/state/city scope already exists." };
  }

  revalidatePath(PATH);
}

export async function updateTerritory(id: string, formData: FormData): Promise<ActionResult> {
  await requireTerritoryManager();

  const parsed = parseTerritoryForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  try {
    await prisma.territory.update({
      where: { id },
      data: {
        name: parsed.data.name ?? null,
        country: parsed.data.country,
        region: parsed.data.region ?? null,
        city: parsed.data.city ?? null,
        assignedToId: parsed.data.assignedToId ?? null,
      },
    });
  } catch {
    return { error: "A territory with that exact country/state/city scope already exists." };
  }

  revalidatePath(PATH);
}

export async function setTerritoryActive(id: string, active: boolean): Promise<void> {
  await requireTerritoryManager();
  await prisma.territory.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}

export async function deleteTerritory(id: string): Promise<ActionResult> {
  await requireTerritoryManager();
  await prisma.territory.delete({ where: { id } });
  revalidatePath(PATH);
  return undefined;
}
