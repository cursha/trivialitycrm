"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { hashPassword } from "@/lib/auth/password";
import { invalidateAllSessionsForUser } from "@/lib/auth/session";
import { CreateUserSchema } from "@/lib/validation/user";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/users";

async function requireUserManager() {
  const user = await requireUser();
  requirePermission(user, "manage_users");
  return user;
}

export async function createUser(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUserManager();

  const parsed = CreateUserSchema.safeParse({
    name: formString(formData, "name"),
    email: formString(formData, "email"),
    roleId: formString(formData, "roleId"),
    teamId: formString(formData, "teamId") || undefined,
    initialPassword: formString(formData, "initialPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  // The administrator chooses this temporary password themselves (Module
  // One has no email delivery to send an invite link) — it is never
  // generated or logged by application code.
  const passwordHash = await hashPassword(parsed.data.initialPassword);

  try {
    await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        roleId: parsed.data.roleId,
        teamId: parsed.data.teamId || null,
        passwordHash,
        mustChangePassword: true,
      },
    });
  } catch {
    return { error: "A user with that email already exists." };
  }

  revalidatePath(PATH);
}

export async function setUserRole(id: string, roleId: string): Promise<void> {
  await requireUserManager();
  await prisma.user.update({ where: { id }, data: { roleId } });
  revalidatePath(PATH);
}

export async function setUserTeam(id: string, teamId: string | null): Promise<void> {
  await requireUserManager();
  await prisma.user.update({ where: { id }, data: { teamId } });
  revalidatePath(PATH);
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<void> {
  const actor = await requireUserManager();

  // Don't let an admin lock themselves out.
  if (actor.id === id && disabled) return;

  await prisma.user.update({ where: { id }, data: { disabled } });

  if (disabled) {
    await invalidateAllSessionsForUser(id);
  }

  revalidatePath(PATH);
}

export async function createTeam(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUserManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  try {
    await prisma.team.create({ data: { name: parsed.data.name } });
  } catch {
    return { error: "A team with that name already exists." };
  }

  revalidatePath(PATH);
}
