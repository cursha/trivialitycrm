"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { recordContactConsentAction } from "./actions";

export type ContactComplianceData = {
  id: string;
  name: string;
  email: string | null;
  companyId: string;
  companyName: string;
  emailPermitted: boolean;
  doNotContact: boolean;
  unsubscribedAt: string | null;
  history: {
    id: string;
    type: string;
    source: string;
    note: string | null;
    occurredAt: string;
    recordedByName: string | null;
  }[];
};

function statusBadge(contact: ContactComplianceData) {
  if (contact.doNotContact) return <Badge tone="danger">Do Not Contact</Badge>;
  if (contact.emailPermitted) return <Badge tone="success">Permitted</Badge>;
  return <Badge tone="neutral">Not Permitted</Badge>;
}

export function ContactComplianceRow({ contact }: { contact: ContactComplianceData }) {
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState(recordContactConsentAction.bind(null, contact.id), undefined);

  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-text">
            {contact.name} {contact.email && <span className="font-normal text-text-muted">({contact.email})</span>}
          </p>
          <Link href={`/companies/${contact.companyId}`} className="text-xs text-secondary hover:underline">
            {contact.companyName}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(contact)}
          <button type="button" onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-secondary hover:underline">
            {expanded ? "Close" : "Record consent / view history"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <form action={formAction} className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select name="type" required defaultValue="EXPRESS" className="mt-1 py-1.5">
                <option value="EXPRESS">Express consent</option>
                <option value="IMPLIED">Implied consent</option>
                <option value="WITHDRAWN">Withdrawn / opt-out</option>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Source</Label>
              <Input name="source" required placeholder="e.g. signed form, verbal at event" className="mt-1 py-1.5" />
            </div>
            <div>
              <Label className="text-xs">Note (optional)</Label>
              <Input name="note" className="mt-1 py-1.5" />
            </div>
            {state?.error && (
              <div className="sm:col-span-3">
                <FieldError>{state.error}</FieldError>
              </div>
            )}
            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={pending}
                className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
              >
                {pending ? "Saving..." : "Record consent"}
              </button>
            </div>
          </form>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">History</p>
            {contact.history.length === 0 ? (
              <p className="mt-1 text-xs text-text-muted">No consent recorded yet.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {contact.history.map((record) => (
                  <li key={record.id} className="text-xs text-text-muted">
                    <span className="font-semibold text-text">{record.type}</span> — {record.source}
                    {record.note && ` (${record.note})`} · {record.occurredAt.slice(0, 10)}
                    {record.recordedByName ? ` · recorded by ${record.recordedByName}` : " · self-service unsubscribe"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
