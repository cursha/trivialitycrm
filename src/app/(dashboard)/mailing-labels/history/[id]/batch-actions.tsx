"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input, Label } from "@/components/ui/field";
import { confirmBatchMailed, confirmBatchPrinted, createReprint, draftFromBatch } from "../../actions";

type Outcome = { ok: boolean; error?: string; batchId?: string };

export function BatchActions({
  batchId,
  available,
  unavailableReason,
  printed,
  mailed,
  capacity,
  recipients,
}: {
  batchId: string;
  available: boolean;
  unavailableReason: string | null;
  printed: boolean;
  mailed: boolean;
  capacity: number;
  recipients: { sequence: number; companyName: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mailNote, setMailNote] = useState("");
  const [showReprint, setShowReprint] = useState(false);
  const [start, setStart] = useState("1");
  const [picked, setPicked] = useState<Set<number>>(new Set());

  function act(fn: () => Promise<Outcome>, after?: (result: Outcome) => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      else if (after) after(result);
      else router.refresh();
    });
  }

  function togglePicked(sequence: number) {
    const next = new Set(picked);
    if (next.has(sequence)) next.delete(sequence);
    else next.add(sequence);
    setPicked(next);
  }

  return (
    <Card className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {available ? (
        <div className="flex flex-wrap gap-2">
          <a href={`/api/mailing-labels/batches/${batchId}/pdf?download=1`} className={buttonClasses("primary")}>
            Download PDF
          </a>
          <a href={`/api/mailing-labels/batches/${batchId}/pdf`} target="_blank" rel="noopener" className={buttonClasses("ghost")}>
            Open PDF
          </a>
          <Button type="button" variant="ghost" onClick={() => setShowReprint(!showReprint)}>
            Reprint some or all at a new position
          </Button>
        </div>
      ) : (
        <Alert tone="warning">{unavailableReason}</Alert>
      )}
      <div>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => act(() => draftFromBatch(batchId), () => router.push("/mailing-labels"))}>
          New draft from current CRM data (same filters)
        </Button>
        <p className="mt-1 text-xs text-text-muted">The draft replaces your current in-progress label job. This batch stays exactly as it is.</p>
      </div>

      {showReprint && available && (
        <div className="space-y-2 rounded-lg border border-border-strong p-3">
          <p className="text-sm text-text">
            A reprint uses this batch&apos;s exact labels, sheet measurements and printer setting. Tick the labels to reprint (for example ones that jammed), or leave all unticked to reprint
            everything.
          </p>
          <div className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-border p-2">
            {recipients.map((r) => (
              <label key={r.sequence} className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" checked={picked.has(r.sequence)} onChange={() => togglePicked(r.sequence)} />#{r.sequence} {r.companyName}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="mb-1 block text-xs">First unused label (1 to {capacity})</Label>
              <Input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} className="w-24" />
            </div>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                act(
                  () => createReprint({ batchId, startPosition: Number(start), sequences: picked.size > 0 ? [...picked] : null }),
                  (result) => router.push(`/mailing-labels/history/${result.batchId}`),
                )
              }
            >
              Create reprint ({picked.size > 0 ? picked.size : recipients.length} labels)
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-xs text-text-muted">Downloading isn&apos;t proof of printing or mailing, so these are only set when you confirm them. Neither changes any company&apos;s sales stage.</p>
        <div className="flex flex-wrap items-center gap-2">
          {!printed && (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => act(() => confirmBatchPrinted(batchId))}>
              Confirm printed
            </Button>
          )}
          {!mailed && (
            <>
              <Input value={mailNote} onChange={(e) => setMailNote(e.target.value)} maxLength={300} placeholder="Mailing note (optional), e.g. November flyer" className="max-w-xs" />
              <Button type="button" variant="secondary" disabled={pending} onClick={() => act(() => confirmBatchMailed(batchId, mailNote))}>
                Confirm mailed
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
