"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/roles";

async function requireUserManager() {
  const user = await requireUser();
  requirePermission(user, "manage_users");
  return user;
}

export async function setRolePermission(roleId: string, permissionId: string, allowed: boolean): Promise<void> {
  await requireUserManager();

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId, permissionId } },
    update: { allowed },
    create: { roleId, permissionId, allowed },
  });

  revalidatePath(PATH);
}

export async function createRole(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUserManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.role.aggregate({ _max: { sortOrder: true } });

  try {
    await prisma.role.create({
      data: { name: parsed.data.name, sortOrder: (highest._max.sortOrder ?? -1) + 1 },
    });
  } catch {
    return { error: "A role with that name already exists." };
  }

  revalidatePath(PATH);
}

export async function setRoleActive(id: string, active: boolean): Promise<void> {
  await requireUserManager();
  await prisma.role.update({ where: { id }, data: { active } });
  revalidatePath(PATH);
}
