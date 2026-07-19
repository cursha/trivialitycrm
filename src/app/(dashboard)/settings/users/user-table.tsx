"use client";

import { useTransition } from "react";
import { setUserRole, setUserTeam, setUserDisabled } from "./actions";
import { ResetPasswordControl } from "./reset-password-control";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";

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
    <Card className="overflow-hidden p-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/5 text-xs uppercase text-text-muted">
          <tr>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Email</th>
            <th className="px-5 py-3">Role</th>
            <th className="px-5 py-3">Team</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Password</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-t border-border">
              <td className="px-5 py-4">
                <span className="font-semibold text-text">{user.name}</span>
                {user.mustChangePassword && (
                  <Badge tone="warning" className="ml-2">
                    Must change password
                  </Badge>
                )}
              </td>
              <td className="px-5 py-4 text-text-muted">{user.email}</td>
              <td className="px-5 py-4">
                <Select
                  defaultValue={user.roleId}
                  disabled={isPending}
                  onChange={(event) => startTransition(() => setUserRole(user.id, event.target.value))}
                  className="w-auto py-1"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="px-5 py-4">
                <Select
                  defaultValue={userTeamIds[user.id] ?? ""}
                  disabled={isPending}
                  onChange={(event) => startTransition(() => setUserTeam(user.id, event.target.value || null))}
                  className="w-auto py-1"
                >
                  <option value="">No team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="px-5 py-4">
                <button
                  type="button"
                  disabled={isPending || user.id === currentUserId}
                  onClick={() => startTransition(() => setUserDisabled(user.id, !user.disabled))}
                  className="disabled:pointer-events-none disabled:opacity-50"
                  title={user.id === currentUserId ? "You cannot disable your own account" : undefined}
                >
                  <Badge tone={user.disabled ? "danger" : "success"}>{user.disabled ? "Disabled" : "Active"}</Badge>
                </button>
              </td>
              <td className="px-5 py-4">
                <ResetPasswordControl userId={user.id} userName={user.name} />
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="px-5 py-8 text-center text-text-muted">
                No users yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
