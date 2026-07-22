"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Input, Select, Label } from "@/components/ui/field";

export function UserFilters({ roles }: { roles: { id: string; name: string }[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [isPending, startTransition] = useTransition();

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`/settings/users?${next.toString()}`));
  }

  return (
    <Card className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor="user-search">Search</Label>
        <Input
          id="user-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && updateParam("q", q)}
          onBlur={() => updateParam("q", q)}
          placeholder="Name or email"
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="user-role-filter">Role</Label>
        <Select id="user-role-filter" defaultValue={searchParams.get("roleId") ?? ""} onChange={(e) => updateParam("roleId", e.target.value)} className="mt-1 w-auto" disabled={isPending}>
          <option value="">All roles</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="user-status-filter">Status</Label>
        <Select id="user-status-filter" defaultValue={searchParams.get("status") ?? ""} onChange={(e) => updateParam("status", e.target.value)} className="mt-1 w-auto" disabled={isPending}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </Select>
      </div>
    </Card>
  );
}
