"use client";

import { useState, useTransition } from "react";
import { setRolePermission, setRoleActive, duplicateRole } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";

export type RoleColumn = { id: string; name: string; active: boolean; userCount: number };
export type PermissionRow = { id: string; key: string; label: string; category: string | null; description: string | null };

const UNCATEGORIZED = "Other";

function groupByCategory(permissions: PermissionRow[]): [string, PermissionRow[]][] {
  const groups = new Map<string, PermissionRow[]>();
  for (const permission of permissions) {
    const category = permission.category ?? UNCATEGORIZED;
    const list = groups.get(category) ?? [];
    list.push(permission);
    groups.set(category, list);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => (a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b)));
}

export function PermissionMatrix({
  roles,
  permissions,
  grants,
}: {
  roles: RoleColumn[];
  permissions: PermissionRow[];
  grants: Set<string>;
}) {
  const [isPending, startTransition] = useTransition();
  const [previewRoleId, setPreviewRoleId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  function isGranted(roleId: string, permissionId: string) {
    return grants.has(`${roleId}:${permissionId}`);
  }

  function toggle(role: RoleColumn, permission: PermissionRow, checked: boolean) {
    if (role.userCount > 0) {
      if (!window.confirm(`${role.name} has ${role.userCount} active user(s). ${checked ? "Grant" : "Revoke"} "${permission.label}" for all of them?`)) return;
    }
    setMatrixError(null);
    startTransition(async () => {
      const result = await setRolePermission(role.id, permission.id, checked);
      if (result?.error) setMatrixError(result.error);
    });
  }

  const grouped = groupByCategory(permissions);

  return (
    <div className="space-y-6">
      {matrixError && <FieldError>{matrixError}</FieldError>}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-xs uppercase text-text-muted">
            <tr>
              <th className="px-5 py-3">Permission</th>
              {roles.map((role) => (
                <th key={role.id} className="px-5 py-3 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <span className="normal-case font-bold text-text">{role.name}</span>
                    <span className="text-[10px] text-text-muted">{role.userCount} active user{role.userCount === 1 ? "" : "s"}</span>
                    <button type="button" disabled={isPending} onClick={() => startTransition(() => setRoleActive(role.id, !role.active))} className="normal-case">
                      <Badge tone={ACTIVE_TONE[role.active ? "active" : "inactive"]} className="text-[10px]">
                        {role.active ? "Active" : "Inactive"}
                      </Badge>
                    </button>
                    <div className="flex gap-1">
                      <button type="button" className="text-[10px] font-semibold text-secondary hover:underline" onClick={() => setPreviewRoleId(previewRoleId === role.id ? null : role.id)}>
                        Preview
                      </button>
                      <button type="button" className="text-[10px] font-semibold text-secondary hover:underline" onClick={() => { setDuplicatingId(role.id); setDuplicateName(`${role.name} copy`); setDuplicateError(null); }}>
                        Duplicate
                      </button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([category, categoryPermissions]) => (
              <>
                <tr key={`heading-${category}`} className="border-t border-border bg-black/5">
                  <td colSpan={1 + roles.length} className="px-5 py-2 text-xs font-bold uppercase tracking-wide text-accent">
                    {category}
                  </td>
                </tr>
                {categoryPermissions.map((permission) => (
                  <tr key={permission.id} className="border-t border-border">
                    <td className="px-5 py-3">
                      <p className="font-medium text-text">{permission.label}</p>
                      {permission.description && <p className="text-xs text-text-muted">{permission.description}</p>}
                    </td>
                    {roles.map((role) => (
                      <td key={role.id} className="px-5 py-3 text-center">
                        <input
                          type="checkbox"
                          disabled={isPending}
                          checked={isGranted(role.id, permission.id)}
                          onChange={(event) => toggle(role, permission, event.target.checked)}
                          className="h-4 w-4 accent-secondary"
                          aria-label={`${permission.label} for ${role.name}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </Card>

      {previewRoleId && (
        <Card>
          {(() => {
            const role = roles.find((r) => r.id === previewRoleId);
            const effective = permissions.filter((p) => isGranted(previewRoleId, p.id));
            return (
              <>
                <p className="text-sm font-bold text-accent">Effective permissions: {role?.name}</p>
                {effective.length === 0 ? (
                  <p className="mt-2 text-sm text-text-muted">This role has no permissions granted.</p>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text">
                    {effective.map((p) => (
                      <li key={p.id}>{p.label}</li>
                    ))}
                  </ul>
                )}
              </>
            );
          })()}
        </Card>
      )}

      {duplicatingId && (
        <Card className="space-y-3">
          <p className="text-sm font-bold text-accent">Duplicate role</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              className="w-64 rounded-lg border border-border-strong bg-surface-raised px-3 py-2 text-sm outline-none focus:border-focus focus:ring-4 focus:ring-focus/20"
            />
            <Button
              type="button"
              disabled={isPending || !duplicateName.trim()}
              onClick={() => {
                setDuplicateError(null);
                startTransition(async () => {
                  const result = await duplicateRole(duplicatingId, duplicateName.trim());
                  if (result?.error) {
                    setDuplicateError(result.error);
                    return;
                  }
                  setDuplicatingId(null);
                });
              }}
            >
              Create copy
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDuplicatingId(null)}>
              Cancel
            </Button>
          </div>
          {duplicateError && <FieldError>{duplicateError}</FieldError>}
        </Card>
      )}
    </div>
  );
}
