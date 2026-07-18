"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transferSearchResults, type TransferResult } from "./actions";
import type { DuplicateMatch } from "@/lib/duplicates/match";

export type TransferRowValues = {
  resultId: string;
  leadTypeName: string;
  competitorName: string | null;
  name: string;
  address1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
  websiteUrl: string;
  contactFirstName: string;
  contactLastName: string;
  contactPhone: string;
  contactEmail: string;
  contactTitle: string;
  score: number;
};

const FIELD_LABELS: [keyof TransferRowValues, string][] = [
  ["name", "Company name"],
  ["address1", "Address"],
  ["city", "City"],
  ["region", "State/Province"],
  ["postalCode", "Postal code"],
  ["country", "Country"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["websiteUrl", "Website"],
];

const CONTACT_FIELD_LABELS: [keyof TransferRowValues, string][] = [
  ["contactFirstName", "First name"],
  ["contactLastName", "Last name"],
  ["contactPhone", "Phone"],
  ["contactEmail", "Email"],
  ["contactTitle", "Title"],
];

export function TransferForm({
  rows: initialRows,
  pipelineStages,
  defaultPipelineStageId,
  salespeople,
  isAdmin,
}: {
  rows: TransferRowValues[];
  pipelineStages: { id: string; name: string }[];
  defaultPipelineStageId: string;
  salespeople: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [assignedToId, setAssignedToId] = useState(salespeople[0]?.id ?? "");
  const [pipelineStageId, setPipelineStageId] = useState(defaultPipelineStageId);
  const [duplicates, setDuplicates] = useState<Record<string, DuplicateMatch[]>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | undefined>();
  const [successCount, setSuccessCount] = useState<number | undefined>();
  const [isPending, startTransition] = useTransition();

  function updateField(resultId: string, field: keyof TransferRowValues, value: string) {
    setRows((prev) => prev.map((row) => (row.resultId === resultId ? { ...row, [field]: value } : row)));
  }

  function handleSubmit() {
    setError(undefined);
    startTransition(async () => {
      const result: TransferResult = await transferSearchResults({
        assignedToId,
        pipelineStageId,
        rows: rows.map((row) => ({ ...row, contactNote: undefined, overrideDuplicate: overrides[row.resultId] ?? false })),
      });

      if ("error" in result) {
        setError(result.error);
      } else if ("duplicates" in result) {
        setDuplicates(result.duplicates);
      } else {
        setDuplicates({});
        setSuccessCount(result.transferredCount);
        router.refresh();
      }
    });
  }

  if (successCount !== undefined) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
        <p className="font-bold">Transferred {successCount} lead(s) to the CRM.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Assign to</label>
          <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {salespeople.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Initial pipeline stage</label>
          <select value={pipelineStageId} onChange={(e) => setPipelineStageId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {pipelineStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows.map((row) => (
        <div key={row.resultId} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="font-bold">
              {row.name} <span className="text-xs font-normal text-slate-400">score {row.score} · {row.leadTypeName}</span>
            </p>
            {row.competitorName && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Uses {row.competitorName}</span>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {FIELD_LABELS.map(([field, label]) => (
              <div key={field}>
                <label className="mb-1 block text-xs font-semibold text-slate-500">{label}</label>
                <input
                  value={row[field] as string}
                  onChange={(e) => updateField(row.resultId, field, e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>

          <p className="pt-2 text-xs font-semibold uppercase text-slate-500">First contact (optional)</p>
          <div className="grid grid-cols-3 gap-3">
            {CONTACT_FIELD_LABELS.map(([field, label]) => (
              <div key={field}>
                <label className="mb-1 block text-xs font-semibold text-slate-500">{label}</label>
                <input
                  value={row[field] as string}
                  onChange={(e) => updateField(row.resultId, field, e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>

          {duplicates[row.resultId] && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold">Possible duplicate:</p>
              <ul className="list-inside list-disc">
                {duplicates[row.resultId].map((match) => (
                  <li key={match.id}>
                    {match.name} ({match.city}, {match.region}) — matched on {match.matchedOn.join(", ")}
                  </li>
                ))}
              </ul>
              {isAdmin ? (
                <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={overrides[row.resultId] ?? false}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [row.resultId]: e.target.checked }))}
                  />
                  Transfer anyway (Administrator override)
                </label>
              ) : (
                <p className="mt-2 text-xs">Only an Administrator can transfer despite a possible duplicate match.</p>
              )}
            </div>
          )}
        </div>
      ))}

      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

      <button type="button" disabled={isPending} onClick={handleSubmit} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
        {isPending ? "Transferring..." : `Transfer ${rows.length} lead(s)`}
      </button>
    </div>
  );
}
