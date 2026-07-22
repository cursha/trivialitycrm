import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PermissionMatrix } from "./permission-matrix";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createRole } from "./actions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Roles & Permissions — Triviality CRM" };

export default async function RolesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_roles");

  const [roles, permissions, rolePermissions, activeUserCountsByRole] = await Promise.all([
    prisma.role.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.permission.findMany({ orderBy: { label: "asc" } }),
    prisma.rolePermission.findMany({ where: { allowed: true } }),
    prisma.user.groupBy({ by: ["roleId"], where: { disabled: false }, _count: true }),
  ]);

  const grants = new Set(rolePermissions.map((rp) => `${rp.roleId}:${rp.permissionId}`));
  const userCountByRole = Object.fromEntries(activeUserCountsByRole.map((g) => [g.roleId, g._count]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="Every permission grant is stored in the database and editable here — nothing is hardcoded. Changing a permission for a role with active users takes effect for all of them immediately."
      />

      <PermissionMatrix
        roles={roles.map((r) => ({ id: r.id, name: r.name, active: r.active, userCount: userCountByRole[r.id] ?? 0 }))}
        permissions={permissions.map((p) => ({ id: p.id, key: p.key, label: p.label, category: p.category, description: p.description }))}
        grants={grants}
      />

      <AddLookupForm create={createRole} placeholder="New role name" />
    </div>
  );
}
