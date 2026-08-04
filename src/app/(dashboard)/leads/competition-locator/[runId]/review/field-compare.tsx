"use client";

import { Input, Label } from "@/components/ui/field";
import { classifyField } from "@/lib/research/competition-locator-buckets";
import { MERGEABLE_TRANSFER_FIELDS, type MergeableTransferField, type FieldDecision } from "@/lib/companies/field-resolution";

const FIELD_LABELS: Record<MergeableTransferField, string> = {
  name: "Name",
  address1: "Street address",
  city: "City",
  region: "State / Province",
  postalCode: "Postal / ZIP code",
  country: "Country",
  phone: "Phone",
  email: "Email",
  websiteUrl: "Website",
};

export type ExistingRecord = Record<MergeableTransferField, string | null>;

/**
 * Only renders a control for fields classified "conflicting" (existing and
 * newly-found both have a value, and they differ) — matching
 * merge-comparison.tsx's existing precedent of only surfacing a decision
 * for fields that actually need one. blank/new/identical fields carry
 * forward automatically (see field-resolution.ts's resolveFieldDecisions
 * default-to-useNew behavior) without cluttering the review UI.
 */
export function FieldCompare({
  existing,
  fresh,
  decisions,
  onChange,
}: {
  existing: ExistingRecord;
  fresh: ExistingRecord;
  decisions: Partial<Record<MergeableTransferField, FieldDecision>>;
  onChange: (field: MergeableTransferField, decision: FieldDecision) => void;
}) {
  const conflicting = MERGEABLE_TRANSFER_FIELDS.filter((field) => classifyField(existing[field], fresh[field]) === "conflicting");

  if (conflicting.length === 0) return null;

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
      <p className="text-xs font-semibold uppercase text-text-muted">Conflicting fields — choose which value to keep</p>
      {conflicting.map((field) => {
        const decision = decisions[field] ?? { mode: "useNew" };
        return (
          <div key={field} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[110px_1fr]">
            <Label className="pt-1.5 text-xs uppercase text-text-muted">{FIELD_LABELS[field]}</Label>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 rounded border border-border-strong p-1.5 text-xs">
                <input type="radio" checked={decision.mode === "keepExisting"} onChange={() => onChange(field, { mode: "keepExisting" })} />
                Keep existing: {existing[field] || <span className="text-text-muted">(blank)</span>}
              </label>
              <label className="flex items-center gap-2 rounded border border-border-strong p-1.5 text-xs">
                <input type="radio" checked={decision.mode === "useNew"} onChange={() => onChange(field, { mode: "useNew" })} />
                Use newly found: {fresh[field] || <span className="text-text-muted">(blank)</span>}
              </label>
              <label className="flex items-center gap-2 rounded border border-border-strong p-1.5 text-xs">
                <input type="radio" checked={decision.mode === "override"} onChange={() => onChange(field, { mode: "override", value: "" })} />
                Enter different value:
                <Input
                  className="ml-1 h-7 flex-1 py-1 text-xs"
                  disabled={decision.mode !== "override"}
                  value={decision.mode === "override" ? decision.value : ""}
                  onChange={(e) => onChange(field, { mode: "override", value: e.target.value })}
                />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
