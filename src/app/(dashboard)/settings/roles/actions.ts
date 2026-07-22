"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupNameSchema } from "@/lib/validation/lookup";
import { formString } from "@/lib/form-data";
import { writeAuditEvent } from "@/lib/audit/log";

export type ActionResult = { error?: string } | undefined;

const PATH = "/settings/roles";

// Module 8A: regated from manage_users to a dedicated manage_roles
// permission — role/permission editing is more sensitive than day-to-day
// user account administration and now requires its own explicit grant.
// Administrator holds both by default; a team that had granted manage_users
// alone to a Manager without intending them to also edit roles now gets
// the correct separation.
async function requireRoleManager() {
  const user = await requireUser();
  requirePermission(user, "manage_roles");
  return user;
}

const ESSENTIAL_ADMINISTRATOR_PERMISSIONS = ["manage_users", "manage_roles"];

/**
 * Prevents revoking manage_users/manage_roles from the Administrator role
 * itself when no other active role would still grant it — the
 * role-definition-level analogue of assertNotLastActiveAdministrator's
 * per-user protection (src/lib/administration/user-safety.ts). Without
 * this, an admin could accidentally lock every Administrator out of ever
 * managing users or roles again, with no user-level safeguard able to
 * catch it (the role itself would still exist and have active users, just
 * with the capability quietly gone).
 */
async function assertRoleKeepsEssentialCapability(roleId: string, permissionKey: string, allowed: boolean): Promise<string | null> {
  if (allowed || !ESSENTIAL_ADMINISTRATOR_PERMISSIONS.includes(permissionKey)) return null;

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.name !== "Administrator") return null;

  const otherGrant = await prisma.rolePermission.findFirst({
    where: {
      allowed: true,
      permission: { key: permissionKey },
      role: { active: true, id: { not: roleId } },
    },
  });
  if (otherGrant) return null;

  return `Revoking "${permissionKey}" from Administrator would leave no active role able to manage users or roles.`;
}

export async function setRolePermission(roleId: string, permissionId: string, allowed: boolean): Promise<ActionResult> {
  const actor = await requireRoleManager();

  const permission = await prisma.permission.findUnique({ where: { id: permissionId } });
  if (!permission) return { error: "Permission not found." };

  const blockReason = await assertRoleKeepsEssentialCapability(roleId, permission.key, allowed);
  if (blockReason) {
    await writeAuditEvent({ actorId: actor.id, module: "roles", action: "role.permission_changed", entityType: "Role", entityId: roleId, success: false, metadata: { permissionKey: permission.key, allowed, reason: "essential_capability" } });
    return { error: blockReason };
  }

  const existing = await prisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId, permissionId } } });

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId, permissionId } },
    update: { allowed },
    create: { roleId, permissionId, allowed },
  });

  await writeAuditEvent({
    actorId: actor.id,
    module: "roles",
    action: "role.permission_changed",
    entityType: "Role",
    entityId: roleId,
    beforeData: { permissionKey: permission.key, allowed: existing?.allowed ?? null },
    afterData: { permissionKey: permission.key, allowed },
  });

  revalidatePath(PATH);
}

export async function createRole(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const actor = await requireRoleManager();

  const parsed = LookupNameSchema.safeParse({ name: formString(formData, "name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const highest = await prisma.role.aggregate({ _max: { sortOrder: true } });

  let created;
  try {
    created = await prisma.role.create({
      data: { name: parsed.data.name, sortOrder: (highest._max.sortOrder ?? -1) + 1 },
    });
  } catch {
    return { error: "A role with that name already exists." };
  }

  await writeAuditEvent({ actorId: actor.id, module: "roles", action: "role.created", entityType: "Role", entityId: created.id, afterData: { name: created.name } });

  revalidatePath(PATH);
}

/**
 * Creates a new role pre-populated with a full copy of an existing role's
 * permission grants — the plan's explicit "duplicate-role function," which
 * had no equivalent before Module 8A (createRole always started from zero
 * grants).
 */
export async function duplicateRole(sourceRoleId: string, newName: string): Promise<ActionResult> {
  const actor = await requireRoleManager();

  const parsed = LookupNameSchema.safeParse({ name: newName });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a name." };
  }

  const source = await prisma.role.findUnique({ where: { id: sourceRoleId }, include: { permissions: { where: { allowed: true } } } });
  if (!source) return { error: "Source role not found." };

  const highest = await prisma.role.aggregate({ _max: { sortOrder: true } });

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { name: parsed.data.name, sortOrder: (highest._max.sortOrder ?? -1) + 1 } });
      if (source.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: source.permissions.map((rp) => ({ roleId: role.id, permissionId: rp.permissionId, allowed: true })),
        });
      }
      return role;
    });
  } catch {
    return { error: "A role with that name already exists." };
  }

  await writeAuditEvent({ actorId: actor.id, module: "roles", action: "role.duplicated", entityType: "Role", entityId: created.id, metadata: { sourceRoleId, sourceName: source.name, grantCount: source.permissions.length } });

  revalidatePath(PATH);
}

export async function setRoleActive(id: string, active: boolean): Promise<void> {
  const actor = await requireRoleManager();
  await prisma.role.update({ where: { id }, data: { active } });
  await writeAuditEvent({ actorId: actor.id, module: "roles", action: active ? "role.activated" : "role.deactivated", entityType: "Role", entityId: id });
  revalidatePath(PATH);
}
