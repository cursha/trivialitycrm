import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PermissionMatrix } from "./permission-matrix";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createRole } from "./actions";

export const metadata = { title: "Roles & Permissions — Triviality CRM" };

export default async function RolesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_users");

  const [roles, permissions, rolePermissions] = await Promise.all([
    prisma.role.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.permission.findMany({ orderBy: { label: "asc" } }),
    prisma.rolePermission.findMany({ where: { allowed: true } }),
  ]);

  const grants = new Set(rolePermissions.map((rp) => `${rp.roleId}:${rp.permissionId}`));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Roles &amp; Permissions</h1>
        <p className="mt-1 text-slate-500">
          Every permission grant is stored in the database and editable here — nothing is hardcoded.
        </p>
      </div>

      <PermissionMatrix roles={roles} permissions={permissions} grants={grants} />

      <AddLookupForm create={createRole} placeholder="New role name" />
    </div>
  );
}
