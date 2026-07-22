"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { hashPassword } from "@/lib/auth/password";
import { invalidateAllSessionsForUser } from "@/lib/auth/session";
import { CreateUserSchema, ResetPasswordSchema } from "@/lib/validation/user";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";
import { writeAuditEvent } from "@/lib/audit/log";
import { assertNotLastActiveAdministrator, LastAdministratorError, getOwnershipSummary, transferOwnership, OwnershipTransferError } from "@/lib/administration/user-safety";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/users";

async function requireUserManager() {
  const user = await requireUser();
  requirePermission(user, "manage_users");
  return user;
}

export async function createUser(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await requireUserManager();

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

  let created;
  try {
    created = await prisma.user.create({
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

  await writeAuditEvent({ actorId: actor.id, module: "users", action: "user.created", entityType: "User", entityId: created.id, afterData: { name: created.name, email: created.email, roleId: created.roleId } });

  revalidatePath(PATH);
}

/**
 * Sets a fresh temporary password for an existing user — never a way to
 * recover their previous one (impossible: only its bcrypt hash exists, and
 * that must stay one-way). The administrator sees the new value because
 * they're the one typing it, the same way "Add a user" already works. Also
 * clears any account lockout, since "forgot/needs their password" and "got
 * locked out trying it" tend to happen together.
 */
export async function resetUserPassword(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await requireUserManager();

  const parsed = ResetPasswordSchema.safeParse({
    userId: formString(formData, "userId"),
    newPassword: formString(formData, "newPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);

  await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null },
  });

  // They'll sign back in with the new temporary password — don't leave a
  // session from before the reset still valid alongside it.
  await invalidateAllSessionsForUser(parsed.data.userId);

  await writeAuditEvent({ actorId: actor.id, module: "users", action: "user.password_reset", entityType: "User", entityId: parsed.data.userId });

  revalidatePath(PATH);
}

export async function setUserRole(id: string, roleId: string): Promise<ActionResult> {
  const actor = await requireUserManager();

  const existing = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!existing) return { error: "User not found." };

  const newRole = await prisma.role.findUnique({ where: { id: roleId } });
  if (!newRole) return { error: "Role not found." };

  // Prevents the CRM from ever being left with no active Administrator —
  // whether the actor is changing their own role or someone else's.
  if (existing.role.name === "Administrator" && newRole.name !== "Administrator") {
    try {
      await assertNotLastActiveAdministrator(id, actor.id, "user.role_changed");
    } catch (error) {
      if (error instanceof LastAdministratorError) return { error: error.message };
      throw error;
    }
  }

  await prisma.user.update({ where: { id }, data: { roleId } });
  await writeAuditEvent({ actorId: actor.id, module: "users", action: "user.role_changed", entityType: "User", entityId: id, beforeData: { roleId: existing.roleId, roleName: existing.role.name }, afterData: { roleId, roleName: newRole.name } });

  revalidatePath(PATH);
}

export async function setUserTeam(id: string, teamId: string | null): Promise<void> {
  const actor = await requireUserManager();
  const existing = await prisma.user.findUnique({ where: { id } });
  await prisma.user.update({ where: { id }, data: { teamId } });
  await writeAuditEvent({ actorId: actor.id, module: "users", action: "user.team_changed", entityType: "User", entityId: id, beforeData: { teamId: existing?.teamId ?? null }, afterData: { teamId } });
  revalidatePath(PATH);
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<ActionResult> {
  const actor = await requireUserManager();

  // Don't let an admin lock themselves out.
  if (actor.id === id && disabled) return { error: "You cannot deactivate your own account." };

  if (disabled) {
    try {
      await assertNotLastActiveAdministrator(id, actor.id, "user.disabled");
    } catch (error) {
      if (error instanceof LastAdministratorError) return { error: error.message };
      throw error;
    }
  }

  await prisma.user.update({ where: { id }, data: { disabled } });

  if (disabled) {
    await invalidateAllSessionsForUser(id);
  }

  await writeAuditEvent({ actorId: actor.id, module: "users", action: disabled ? "user.disabled" : "user.enabled", entityType: "User", entityId: id });

  revalidatePath(PATH);
}

export async function unlockUserAccount(id: string): Promise<ActionResult> {
  const actor = await requireUserManager();
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return { error: "User not found." };

  await prisma.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  await writeAuditEvent({ actorId: actor.id, module: "users", action: "user.unlocked", entityType: "User", entityId: id });

  revalidatePath(PATH);
}

export async function revokeUserSessions(id: string): Promise<ActionResult> {
  const actor = await requireUserManager();
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return { error: "User not found." };

  await invalidateAllSessionsForUser(id);
  await writeAuditEvent({ actorId: actor.id, module: "users", action: "user.sessions_revoked", entityType: "User", entityId: id });

  revalidatePath(PATH);
}

export async function fetchOwnershipSummary(id: string) {
  await requireUserManager();
  return getOwnershipSummary(id);
}

export async function transferUserOwnership(fromUserId: string, toUserId: string): Promise<ActionResult> {
  const actor = await requireUserManager();

  try {
    await transferOwnership({ fromUserId, toUserId, actorId: actor.id });
  } catch (error) {
    if (error instanceof OwnershipTransferError) return { error: error.message };
    throw error;
  }

  revalidatePath(PATH);
  revalidatePath("/companies");
  revalidatePath("/pipeline");
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
