import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { UserTable } from "./user-table";
import { AddUserForm } from "./add-user-form";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createTeam } from "./actions";

export const metadata = { title: "Users — Triviality CRM" };

export default async function UsersPage() {
  const currentUser = await requireUser();
  requirePermission(currentUser, "manage_users");

  const [users, roles, teams] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" } }),
    prisma.role.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.team.findMany({ orderBy: { name: "asc" } }),
  ]);

  const userTeamIds = Object.fromEntries(users.map((u) => [u.id, u.teamId]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight">Users</h1>
        <p className="mt-1 text-slate-500">
          Create accounts, assign roles and teams, and disable access. There is no public sign-up — every account is
          created here.
        </p>
      </div>

      <UserTable users={users} roles={roles} teams={teams} userTeamIds={userTeamIds} currentUserId={currentUser.id} />

      <AddUserForm roles={roles} teams={teams} />

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-700">Teams</h3>
        <p className="text-sm text-slate-500">
          {teams.length === 0 ? "No teams yet." : teams.map((t) => t.name).join(", ")}
        </p>
        <AddLookupForm create={createTeam} placeholder="New team name" />
      </div>
    </div>
  );
}
