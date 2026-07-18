"use client";

import { useTransition } from "react";
import { setRolePermission, setRoleActive } from "./actions";

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
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case ${
                      role.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {role.active ? "Active" : "Inactive"}
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissions.map((permission) => (
            <tr key={permission.id} className="border-t border-slate-100">
              <td className="px-5 py-3 font-medium">{permission.label}</td>
              {roles.map((role) => (
                <td key={role.id} className="px-5 py-3 text-center">
                  <input
                    type="checkbox"
                    disabled={isPending}
                    checked={isGranted(role.id, permission.id)}
                    onChange={(event) =>
                      startTransition(() => setRolePermission(role.id, permission.id, event.target.checked))
                    }
                    className="h-4 w-4 accent-blue-600"
                    aria-label={`${permission.label} for ${role.name}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
