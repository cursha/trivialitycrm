"use client";

import { useTransition } from "react";
import { setUserRole, setUserTeam, setUserDisabled } from "./actions";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  disabled: boolean;
  mustChangePassword: boolean;
  roleId: string;
};

export function UserTable({
  users,
  roles,
  teams,
  userTeamIds,
  currentUserId,
}: {
  users: UserRow[];
  roles: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  userTeamIds: Record<string, string | null>;
  currentUserId: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Email</th>
            <th className="px-5 py-3">Role</th>
            <th className="px-5 py-3">Team</th>
            <th className="px-5 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-slate-100">
              <td className="px-5 py-4">
                <span className="font-semibold">{user.name}</span>
                {user.mustChangePassword && (
                  <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    Must change password
                  </span>
                )}
              </td>
              <td className="px-5 py-4 text-slate-600">{user.email}</td>
              <td className="px-5 py-4">
                <select
                  defaultValue={user.roleId}
                  disabled={isPending}
                  onChange={(event) => startTransition(() => setUserRole(user.id, event.target.value))}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-5 py-4">
                <select
                  defaultValue={userTeamIds[user.id] ?? ""}
                  disabled={isPending}
                  onChange={(event) => startTransition(() => setUserTeam(user.id, event.target.value || null))}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">No team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-5 py-4">
                <button
                  type="button"
                  disabled={isPending || user.id === currentUserId}
                  onClick={() => startTransition(() => setUserDisabled(user.id, !user.disabled))}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                    user.disabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                  }`}
                  title={user.id === currentUserId ? "You cannot disable your own account" : undefined}
                >
                  {user.disabled ? "Disabled" : "Active"}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
