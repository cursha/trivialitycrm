"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, SectionHeading } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, Label, FieldError } from "@/components/ui/field";
import { mergeCompanyDuplicate, mergeContactDuplicate } from "../actions";

type RecordSummary = { id: string; label: string; extra: string; eosScore: number | null; eosGrade: string | null };
type FieldComparison = { key: string; label: string; valueA: string | null; valueB: string | null };

export function MergeComparison({
  entityType,
  potentialDuplicateId,
  recordA,
  recordB,
  fields,
  companyId,
}: {
  entityType: "COMPANY" | "CONTACT";
  potentialDuplicateId: string;
  recordA: RecordSummary;
  recordB: RecordSummary;
  fields: FieldComparison[];
  companyId: string;
}) {
  const [survivor, setSurvivor] = useState<"A" | "B">("A");
  const [fieldChoices, setFieldChoices] = useState<Record<string, "A" | "B">>({});
  const [eosChoice, setEosChoice] = useState<"surviving" | "merged">("surviving");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const conflicting = useMemo(() => fields.filter((f) => (f.valueA ?? "") !== (f.valueB ?? "")), [fields]);

  const survivingRecord = survivor === "A" ? recordA : recordB;
  const mergedRecord = survivor === "A" ? recordB : recordA;

  function fieldDecisions(): Record<string, string> {
    const decisions: Record<string, string> = {};
    for (const field of conflicting) {
      const choice = fieldChoices[field.key] ?? survivor;
      const chosenValue = choice === "A" ? field.valueA : field.valueB;
      const survivorValue = survivor === "A" ? field.valueA : field.valueB;
      // Only include an explicit decision when it differs from what the
      // survivor already has — no-op otherwise.
      if (chosenValue !== survivorValue && chosenValue !== null) {
        decisions[field.key] = chosenValue;
      }
    }
    return decisions;
  }

  function handleMerge() {
    const survivingId = survivingRecord.id;
    const mergedId = mergedRecord.id;
    if (!window.confirm(`Merge "${mergedRecord.label}" into "${survivingRecord.label}"? This cannot be undone — the merged record is preserved as history but will no longer be editable directly.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result =
        entityType === "COMPANY"
          ? await mergeCompanyDuplicate(potentialDuplicateId, survivingId, mergedId, fieldDecisions(), eosChoice)
          : await mergeContactDuplicate(potentialDuplicateId, survivingId, mergedId, fieldDecisions(), companyId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <Card className="space-y-4">
      <div>
        <SectionHeading>Choose the surviving record</SectionHeading>
        <p className="mt-1 text-xs text-text-muted">The other record is preserved as history, tombstoned, and never permanently deleted.</p>
        <div className="mt-2 flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="survivor" checked={survivor === "A"} onChange={() => setSurvivor("A")} />
            Keep &quot;{recordA.label}&quot;
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="survivor" checked={survivor === "B"} onChange={() => setSurvivor("B")} />
            Keep &quot;{recordB.label}&quot;
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[recordA, recordB].map((record, index) => (
          <div key={record.id} className="rounded-lg border border-border-strong p-3">
            <p className="text-sm font-bold text-text">{record.label}</p>
            <p className="text-xs text-text-muted">{record.extra}</p>
            {record.eosScore !== null && (
              <p className="text-xs text-text-muted">
                EOS score: {record.eosScore} ({record.eosGrade})
              </p>
            )}
            <p className="mt-1 text-xs font-semibold text-secondary">{(index === 0 ? "A" : "B") === survivor ? "Surviving" : "Will be merged away"}</p>
          </div>
        ))}
      </div>

      {conflicting.length > 0 && (
        <div>
          <SectionHeading>Conflicting fields</SectionHeading>
          <div className="mt-2 space-y-3">
            {conflicting.map((field) => (
              <div key={field.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_1fr] sm:items-center">
                <Label className="text-xs uppercase text-text-muted">{field.label}</Label>
                <label className="flex items-center gap-2 rounded border border-border-strong p-2 text-sm">
                  <input
                    type="radio"
                    name={`field-${field.key}`}
                    checked={(fieldChoices[field.key] ?? survivor) === "A"}
                    onChange={() => setFieldChoices((prev) => ({ ...prev, [field.key]: "A" }))}
                  />
                  {field.valueA || <span className="text-text-muted">(blank)</span>}
                </label>
                <label className="flex items-center gap-2 rounded border border-border-strong p-2 text-sm">
                  <input
                    type="radio"
                    name={`field-${field.key}`}
                    checked={(fieldChoices[field.key] ?? survivor) === "B"}
                    onChange={() => setFieldChoices((prev) => ({ ...prev, [field.key]: "B" }))}
                  />
                  {field.valueB || <span className="text-text-muted">(blank)</span>}
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {entityType === "COMPANY" && (
        <div>
          <Label htmlFor="eos-choice">EOS scoring</Label>
          <Select id="eos-choice" value={eosChoice} onChange={(e) => setEosChoice(e.target.value as typeof eosChoice)} className="mt-1 max-w-xs">
            <option value="surviving">Keep the surviving company&apos;s current score</option>
            <option value="merged">Adopt the merged company&apos;s current score</option>
          </Select>
          <p className="mt-1 text-xs text-text-muted">Full scoring history from both companies is preserved either way — this only decides which score is &quot;current.&quot;</p>
        </div>
      )}

      {error && <FieldError>{error}</FieldError>}

      <Button type="button" variant="destructive" disabled={isPending} onClick={handleMerge}>
        {isPending ? "Merging…" : "Merge records"}
      </Button>
    </Card>
  );
}
