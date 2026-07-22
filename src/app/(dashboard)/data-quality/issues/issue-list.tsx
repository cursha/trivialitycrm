"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, FieldError } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { toneFor, DATA_QUALITY_SEVERITY_TONE, DATA_QUALITY_ISSUE_STATUS_TONE, humanizeEnum } from "@/lib/ui/status-tones";
import { setIssueStatus, assignIssue, bulkUpdateIssues, correctIssueField } from "./actions";

export type IssueRow = {
  id: string;
  entityType: "COMPANY" | "CONTACT";
  field: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "DEFERRED" | "RESOLVED" | "IGNORED" | "REOPENED";
  description: string;
  detectedAt: string;
  notes: string | null;
  ruleName: string;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactCompanyId: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
};

function CorrectionForm({ issue, onDone }: { issue: IssueRow; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center"
      action={(formData) => {
        if (!window.confirm("Apply this correction? It will be recorded in the audit trail.")) return;
        setError(null);
        startTransition(async () => {
          const result = await correctIssueField(issue.id, formData);
          if (result?.error) {
            setError(result.error);
            return;
          }
          onDone();
          router.refresh();
        });
      }}
    >
      <Input name="value" placeholder={`New value for ${issue.field}`} className="max-w-xs" />
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Save correction
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </form>
  );
}

export function IssueList({ issues, salespeople, total }: { issues: IssueRow[]; salespeople: { id: string; name: string }[]; total: number }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(action: "assign" | "defer" | "ignore") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    startTransition(async () => {
      await bulkUpdateIssues(ids, action, action === "assign" ? bulkAssignee || null : undefined);
      setSelected(new Set());
      router.refresh();
    });
  }

  if (issues.length === 0) {
    return (
      <Card>
        <EmptyState>No issues match these filters.</EmptyState>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-black/5 px-4 py-3">
        <p className="text-sm text-text-muted">{total} total · {selected.size} selected</p>
        <Select value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)} className="w-auto">
          <option value="">Assign to…</option>
          {salespeople.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </Select>
        <Button type="button" variant="secondary" disabled={selected.size === 0 || isPending} onClick={() => runBulk("assign")}>
          Bulk assign
        </Button>
        <Button type="button" variant="secondary" disabled={selected.size === 0 || isPending} onClick={() => runBulk("defer")}>
          Bulk defer
        </Button>
        <Button type="button" variant="secondary" disabled={selected.size === 0 || isPending} onClick={() => runBulk("ignore")}>
          Bulk ignore
        </Button>
      </div>

      <div className="divide-y divide-border">
        {issues.map((issue) => {
          const recordHref = issue.entityType === "COMPANY" ? (issue.companyId ? `/companies/${issue.companyId}` : null) : issue.contactCompanyId ? `/companies/${issue.contactCompanyId}` : null;
          const recordLabel = issue.entityType === "COMPANY" ? issue.companyName : issue.contactName;

          return (
            <div key={issue.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.has(issue.id)} onChange={() => toggle(issue.id)} className="mt-1.5" aria-label={`Select issue for ${recordLabel ?? "record"}`} />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={toneFor(DATA_QUALITY_SEVERITY_TONE, issue.severity)}>{humanizeEnum(issue.severity)}</Badge>
                    <Badge tone={toneFor(DATA_QUALITY_ISSUE_STATUS_TONE, issue.status)}>{humanizeEnum(issue.status)}</Badge>
                    <span className="text-xs text-text-muted">{issue.ruleName}</span>
                  </div>
                  <p className="mt-1 text-sm text-text">
                    {recordHref ? (
                      <Link href={recordHref} className="font-semibold text-secondary hover:underline">
                        {recordLabel ?? "View record"}
                      </Link>
                    ) : (
                      <span className="font-semibold">{recordLabel ?? "Unknown record"}</span>
                    )}
                    {" — "}
                    {issue.description}
                  </p>
                  {issue.notes && <p className="mt-1 text-xs text-text-muted">Note: {issue.notes}</p>}

                  {correctingId === issue.id && <CorrectionForm issue={issue} onDone={() => setCorrectingId(null)} />}

                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <button type="button" className="font-semibold text-secondary hover:underline" onClick={() => setCorrectingId(correctingId === issue.id ? null : issue.id)}>
                      Correct value
                    </button>
                    {issue.status !== "DEFERRED" && (
                      <button type="button" className="font-semibold text-text-muted hover:underline" disabled={isPending} onClick={() => startTransition(async () => { await setIssueStatus(issue.id, "DEFERRED"); router.refresh(); })}>
                        Defer
                      </button>
                    )}
                    {issue.status !== "IGNORED" && (
                      <button type="button" className="font-semibold text-text-muted hover:underline" disabled={isPending} onClick={() => startTransition(async () => { await setIssueStatus(issue.id, "IGNORED"); router.refresh(); })}>
                        Ignore
                      </button>
                    )}
                    {(issue.status === "DEFERRED" || issue.status === "IGNORED") && (
                      <button type="button" className="font-semibold text-text-muted hover:underline" disabled={isPending} onClick={() => startTransition(async () => { await setIssueStatus(issue.id, "REOPENED"); router.refresh(); })}>
                        Reopen
                      </button>
                    )}
                    <select
                      className="rounded border border-border-strong bg-surface-raised px-1 py-0.5 text-xs"
                      value={issue.assignedToId ?? ""}
                      onChange={(e) => startTransition(async () => { await assignIssue(issue.id, e.target.value || null); router.refresh(); })}
                      aria-label="Assign reviewer"
                    >
                      <option value="">Unassigned</option>
                      {salespeople.map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
