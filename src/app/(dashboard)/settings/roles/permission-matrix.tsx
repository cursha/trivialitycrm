"use client";

import { useTransition } from "react";
import { setRolePermission, setRoleActive } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";

export type RoleColumn = { id: string; name: string; active: boolean };
export type PermissionRow = { id: string; key: string; label: string };

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

  function isGranted(roleId: string, permissionId: string) {
    return grants.has(`${roleId}:${permissionId}`);
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/5 text-xs uppercase text-text-muted">
          <tr>
            <th className="px-5 py-3">Permission</th>
            {roles.map((role) => (
              <th key={role.id} className="px-5 py-3 text-center">
                <div className="flex flex-col items-center gap-1">
                  <span>{role.name}</span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => startTransition(() => setRoleActive(role.id, !role.active))}
                    className="normal-case"
                  >
                    <Badge tone={ACTIVE_TONE[role.active ? "active" : "inactive"]} className="text-[10px]">
                      {role.active ? "Active" : "Inactive"}
                    </Badge>
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissions.map((permission) => (
            <tr key={permission.id} className="border-t border-border">
              <td className="px-5 py-3 font-medium text-text">{permission.label}</td>
              {roles.map((role) => (
                <td key={role.id} className="px-5 py-3 text-center">
                  <input
                    type="checkbox"
                    disabled={isPending}
                    checked={isGranted(role.id, permission.id)}
                    onChange={(event) =>
                      startTransition(() => setRolePermission(role.id, permission.id, event.target.checked))
                    }
                    className="h-4 w-4 accent-secondary"
                    aria-label={`${permission.label} for ${role.name}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
