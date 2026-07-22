import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { UserTable } from "./user-table";
import { AddUserForm } from "./add-user-form";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createTeam } from "./actions";
import { PageHeader } from "@/components/ui/page-header";
import { UserFilters } from "./user-filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Users — Triviality CRM" };

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await requireUser();
  requirePermission(currentUser, "manage_users");

  const params = await searchParams;
  const q = toSingle(params.q)?.trim();
  const roleId = toSingle(params.roleId);
  const status = toSingle(params.status);

  const where: Prisma.UserWhereInput = {
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { email: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(roleId ? { roleId } : {}),
    ...(status === "active" ? { disabled: false } : status === "disabled" ? { disabled: true } : {}),
  };

  const [users, roles, teams] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { name: "asc" } }),
    prisma.role.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
  ]);

  const userTeamIds = Object.fromEntries(users.map((u) => [u.id, u.teamId]));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Users"
        description="Create accounts, assign roles and teams, and disable access. There is no public sign-up — every account is created here."
      />

      <UserFilters roles={roles.map((r) => ({ id: r.id, name: r.name }))} />

      <UserTable
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          disabled: u.disabled,
          mustChangePassword: u.mustChangePassword,
          roleId: u.roleId,
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
          lockedUntil: u.lockedUntil ? u.lockedUntil.toISOString() : null,
        }))}
        roles={roles}
        teams={teams}
        userTeamIds={userTeamIds}
        currentUserId={currentUser.id}
      />

      <AddUserForm roles={roles} teams={teams} />

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-accent">Teams</h3>
        <p className="text-sm text-text-muted">
          {teams.length === 0 ? "No teams yet." : teams.map((t) => t.name).join(", ")}
        </p>
        <AddLookupForm create={createTeam} placeholder="New team name" />
      </div>
    </div>
  );
}
