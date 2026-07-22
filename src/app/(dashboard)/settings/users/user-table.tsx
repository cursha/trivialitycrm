"use client";

import { useState, useTransition } from "react";
import { setUserRole, setUserTeam, setUserDisabled, unlockUserAccount, revokeUserSessions, fetchOwnershipSummary, transferUserOwnership } from "./actions";
import { ResetPasswordControl } from "./reset-password-control";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  disabled: boolean;
  mustChangePassword: boolean;
  roleId: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
};

function isCurrentlyLockedOut(lockedUntil: string | null): boolean {
  return lockedUntil !== null && new Date(lockedUntil) > new Date();
}

function TransferPanel({ user, otherUsers, onDone }: { user: UserRow; otherUsers: { id: string; name: string }[]; onDone: () => void }) {
  const [summary, setSummary] = useState<{ companyCount: number; openTaskCount: number } | null>(null);
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (summary === null) {
    startTransition(async () => {
      setSummary(await fetchOwnershipSummary(user.id));
    });
    return <p className="text-xs text-text-muted">Loading ownership…</p>;
  }

  if (summary.companyCount === 0 && summary.openTaskCount === 0) {
    return <p className="text-xs text-text-muted">{user.name} owns no active companies or open tasks — nothing to transfer.</p>;
  }

  return (
    <div className="space-y-2 rounded-lg border border-border-strong p-3">
      <p className="text-xs text-text">
        {user.name} owns <strong>{summary.companyCount}</strong> active companies and <strong>{summary.openTaskCount}</strong> open tasks.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="w-auto" disabled={isPending}>
          <option value="">Transfer to…</option>
          {otherUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending || !targetId}
          onClick={() => {
            if (!window.confirm(`Transfer all of ${user.name}'s active companies and open tasks to the selected user?`)) return;
            setError(null);
            startTransition(async () => {
              const result = await transferUserOwnership(user.id, targetId);
              if (result?.error) {
                setError(result.error);
                return;
              }
              onDone();
            });
          }}
        >
          Transfer
        </Button>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

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
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function setError(userId: string, message: string | null) {
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[userId] = message;
      else delete next[userId];
      return next;
    });
  }

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
            <th className="px-5 py-3">Last login</th>
            <th className="px-5 py-3">Password</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const lockedOut = isCurrentlyLockedOut(user.lockedUntil);
            return (
              <>
                <tr key={user.id} className="border-t border-border align-top">
                  <td className="px-5 py-4">
                    <span className="font-semibold text-text">{user.name}</span>
                    {user.mustChangePassword && (
                      <Badge tone="warning" className="ml-2">
                        Must change password
                      </Badge>
                    )}
                    {lockedOut && (
                      <Badge tone="danger" className="ml-2">
                        Locked out
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-muted">{user.email}</td>
                  <td className="px-5 py-4">
                    <Select
                      defaultValue={user.roleId}
                      disabled={isPending}
                      onChange={(event) =>
                        startTransition(async () => {
                          const result = await setUserRole(user.id, event.target.value);
                          setError(user.id, result?.error ?? null);
                        })
                      }
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
                      onClick={() =>
                        startTransition(async () => {
                          const result = await setUserDisabled(user.id, !user.disabled);
                          setError(user.id, result?.error ?? null);
                        })
                      }
                      className="disabled:pointer-events-none disabled:opacity-50"
                      title={user.id === currentUserId ? "You cannot disable your own account" : undefined}
                    >
                      <Badge tone={user.disabled ? "danger" : "success"}>{user.disabled ? "Disabled" : "Active"}</Badge>
                    </button>
                  </td>
                  <td className="px-5 py-4 text-text-muted">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td className="px-5 py-4">
                    <ResetPasswordControl userId={user.id} userName={user.name} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button type="button" className="text-xs font-semibold text-secondary hover:underline" onClick={() => setExpandedId(expandedId === user.id ? null : user.id)}>
                      {expandedId === user.id ? "Hide" : "Manage"}
                    </button>
                  </td>
                </tr>
                {rowErrors[user.id] && (
                  <tr key={`${user.id}-error`} className="border-t-0">
                    <td colSpan={8} className="bg-danger/5 px-5 py-2">
                      <FieldError>{rowErrors[user.id]}</FieldError>
                    </td>
                  </tr>
                )}
                {expandedId === user.id && (
                  <tr key={`${user.id}-manage`} className="border-t-0">
                    <td colSpan={8} className="space-y-3 bg-black/5 px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        {lockedOut && (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isPending}
                            onClick={() =>
                              startTransition(async () => {
                                await unlockUserAccount(user.id);
                              })
                            }
                          >
                            Unlock account
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={isPending}
                          onClick={() => {
                            if (!window.confirm(`Revoke all active sessions for ${user.name}? They will be signed out everywhere immediately.`)) return;
                            startTransition(async () => {
                              await revokeUserSessions(user.id);
                            });
                          }}
                        >
                          Revoke sessions
                        </Button>
                      </div>
                      <TransferPanel user={user} otherUsers={users.filter((u) => u.id !== user.id && !u.disabled).map((u) => ({ id: u.id, name: u.name }))} onDone={() => setExpandedId(null)} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
          {users.length === 0 && (
            <tr>
              <td colSpan={8} className="px-5 py-8 text-center text-text-muted">
                No users match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
