"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export type AuditEventRow = {
  id: string;
  summary: string;
  actorName: string;
  module: string;
  action: string;
  success: boolean;
  entityType: string | null;
  entityId: string | null;
  correlationId: string | null;
  occurredAt: string;
  before: unknown;
  after: unknown;
};

function DiffBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-text-muted">{label}</p>
      <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/5 p-2 text-xs text-text">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export function AuditEventList({ events, total }: { events: AuditEventRow[]; total: number }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <Card>
        <EmptyState>No audit events match these filters.</EmptyState>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <p className="border-b border-border bg-black/5 px-4 py-2 text-xs text-text-muted">{total} total events</p>
      <div className="divide-y divide-border">
        {events.map((event) => (
          <div key={event.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={event.success ? "neutral" : "danger"}>{event.success ? event.module : "Blocked"}</Badge>
              <span className="text-xs text-text-muted">{new Date(event.occurredAt).toLocaleString()}</span>
              <span className="text-xs text-text-muted">by {event.actorName}</span>
              {event.correlationId && <span className="text-xs text-text-muted">· correlation: {event.correlationId.slice(0, 8)}</span>}
            </div>
            <p className="mt-1 text-sm text-text">{event.summary}</p>
            {Boolean(event.before || event.after) && (
              <button type="button" className="mt-1 text-xs font-semibold text-secondary hover:underline" onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}>
                {expandedId === event.id ? "Hide details" : "Show details"}
              </button>
            )}
            {expandedId === event.id && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <DiffBlock label="Before" value={event.before} />
                <DiffBlock label="After" value={event.after} />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
