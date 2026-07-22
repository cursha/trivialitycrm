"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Input, Select, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { exportAuditLog } from "./actions";

export type CurrentFilters = {
  from?: string;
  to?: string;
  actorId?: string;
  module?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  success?: string;
  correlationId?: string;
};

function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function AuditLogFilters({
  actors,
  modules,
  canExport,
  currentFilters,
}: {
  actors: { id: string; name: string }[];
  modules: string[];
  canExport: boolean;
  currentFilters: CurrentFilters;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState(currentFilters);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function apply() {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) qs.set(key, value);
    }
    router.push(`/administration/audit-log?${qs.toString()}`);
  }

  return (
    <Card className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label>From</Label>
          <Input type="date" value={filters.from ?? ""} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="mt-1" />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={filters.to ?? ""} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="mt-1" />
        </div>
        <div>
          <Label>User</Label>
          <Select value={filters.actorId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value }))} className="mt-1">
            <option value="">All users</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Module</Label>
          <Select value={filters.module ?? ""} onChange={(e) => setFilters((f) => ({ ...f, module: e.target.value }))} className="mt-1">
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Action</Label>
          <Input value={filters.action ?? ""} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} placeholder="e.g. user.disabled" className="mt-1" />
        </div>
        <div>
          <Label>Entity type</Label>
          <Input value={filters.entityType ?? ""} onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))} className="mt-1" />
        </div>
        <div>
          <Label>Entity ID</Label>
          <Input value={filters.entityId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value }))} className="mt-1" />
        </div>
        <div>
          <Label>Result</Label>
          <Select value={filters.success ?? ""} onChange={(e) => setFilters((f) => ({ ...f, success: e.target.value }))} className="mt-1">
            <option value="">Success and failure</option>
            <option value="true">Success only</option>
            <option value="false">Blocked/failed only</option>
          </Select>
        </div>
        <div>
          <Label>Correlation ID</Label>
          <Input value={filters.correlationId ?? ""} onChange={(e) => setFilters((f) => ({ ...f, correlationId: e.target.value }))} className="mt-1" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={apply}>
          Apply filters
        </Button>
        {canExport && (
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setExportError(null);
                const result = await exportAuditLog(filters);
                if (result.error) {
                  setExportError(result.error);
                  return;
                }
                if (result.csv) downloadCsv(result.csv);
              })
            }
          >
            {isPending ? "Exporting…" : "Export CSV"}
          </Button>
        )}
        {exportError && <span className="text-sm font-semibold text-danger">{exportError}</span>}
      </div>
    </Card>
  );
}
