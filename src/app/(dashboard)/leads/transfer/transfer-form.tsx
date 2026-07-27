"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { transferSearchResults, type TransferResult } from "./actions";
import type { DuplicateMatch } from "@/lib/duplicates/match";
import { Card } from "@/components/ui/card";
import { Label, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

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

type DuplicateResolution = { action: "replace" | "merge" | "ignore"; targetCompanyId?: string };

const ACTION_LABEL: Record<DuplicateResolution["action"], string> = {
  replace: "Replace",
  merge: "Merge",
  ignore: "Ignore",
};

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
  const [resolutions, setResolutions] = useState<Record<string, DuplicateResolution>>({});
  const [error, setError] = useState<string | undefined>();
  const [successCounts, setSuccessCounts] = useState<{ transferredCount: number; ignoredCount: number } | undefined>();
  const [isPending, startTransition] = useTransition();

  function updateField(resultId: string, field: keyof TransferRowValues, value: string) {
    setRows((prev) => prev.map((row) => (row.resultId === resultId ? { ...row, [field]: value } : row)));
  }

  function setResolution(resultId: string, action: DuplicateResolution["action"], targetCompanyId?: string) {
    setResolutions((prev) => ({ ...prev, [resultId]: { action, targetCompanyId } }));
  }

  function handleSubmit() {
    setError(undefined);
    startTransition(async () => {
      const result: TransferResult = await transferSearchResults({
        assignedToId,
        pipelineStageId,
        rows: rows.map((row) => ({
          ...row,
          contactNote: undefined,
          duplicateAction: resolutions[row.resultId]?.action,
          duplicateTargetCompanyId: resolutions[row.resultId]?.targetCompanyId,
        })),
      });

      if ("error" in result) {
        setError(result.error);
      } else if ("duplicates" in result) {
        setDuplicates(result.duplicates);
      } else {
        setDuplicates({});
        setSuccessCounts(result);
        router.refresh();
      }
    });
  }

  if (successCounts !== undefined) {
    return (
      <Alert tone="success" className="block p-6 text-base">
        Transferred {successCounts.transferredCount} lead(s) to the CRM.
        {successCounts.ignoredCount > 0 ? ` ${successCounts.ignoredCount} ignored.` : ""}
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="grid grid-cols-2 gap-4">
        <div>
          <Label className="mb-1 block text-xs uppercase">Assign to</Label>
          <Select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
            {salespeople.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs uppercase">Initial pipeline stage</Label>
          <Select value={pipelineStageId} onChange={(e) => setPipelineStageId(e.target.value)}>
            {pipelineStages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {rows.map((row) => (
        <Card key={row.resultId} className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-bold text-text">
              {row.name} <span className="text-xs font-normal text-text-muted">score {row.score} · {row.leadTypeName}</span>
            </p>
            {row.competitorName && <Badge tone="warning">Uses {row.competitorName}</Badge>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {FIELD_LABELS.map(([field, label]) => (
              <div key={field}>
                <Label className="mb-1 block text-xs">{label}</Label>
                <Input
                  value={row[field] as string}
                  onChange={(e) => updateField(row.resultId, field, e.target.value)}
                  className="py-1.5"
                />
              </div>
            ))}
          </div>

          <p className="pt-2 text-xs font-semibold uppercase text-text-muted">First contact (optional)</p>
          <div className="grid grid-cols-3 gap-3">
            {CONTACT_FIELD_LABELS.map(([field, label]) => (
              <div key={field}>
                <Label className="mb-1 block text-xs">{label}</Label>
                <Input
                  value={row[field] as string}
                  onChange={(e) => updateField(row.resultId, field, e.target.value)}
                  className="py-1.5"
                />
              </div>
            ))}
          </div>

          {duplicates[row.resultId] && (
            <Alert tone="warning" className="block space-y-2">
              <p className="font-semibold">Possible duplicate:</p>
              <ul className="list-inside list-disc font-normal">
                {duplicates[row.resultId].map((match) => (
                  <li key={match.id}>
                    {match.name} ({match.city}, {match.region}) — matched on {match.matchedOn.join(", ")}
                  </li>
                ))}
              </ul>
              {isAdmin ? (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(["replace", "merge", "ignore"] as const).map((action) => {
                      const matches = duplicates[row.resultId];
                      const defaultTarget = matches.length === 1 ? matches[0].id : undefined;
                      const selected = resolutions[row.resultId]?.action === action;
                      return (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setResolution(row.resultId, action, action === "ignore" ? undefined : defaultTarget)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selected ? "bg-primary text-white" : "bg-black/5 text-text-muted"}`}
                        >
                          {ACTION_LABEL[action]}
                        </button>
                      );
                    })}
                  </div>
                  {(resolutions[row.resultId]?.action === "replace" || resolutions[row.resultId]?.action === "merge") && duplicates[row.resultId].length > 1 && (
                    <div>
                      <Label className="mb-1 block text-xs">Which existing company?</Label>
                      <Select
                        value={resolutions[row.resultId]?.targetCompanyId ?? ""}
                        onChange={(e) => setResolution(row.resultId, resolutions[row.resultId]!.action, e.target.value)}
                        className="w-auto py-1.5"
                      >
                        <option value="" disabled>
                          Choose one...
                        </option>
                        {duplicates[row.resultId].map((match) => (
                          <option key={match.id} value={match.id}>
                            {match.name} ({match.city}, {match.region})
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <p className="text-xs font-normal text-text-muted">
                    Replace overwrites every field with this fresh data. Merge uses the fresh data wherever it has a value, and only
                    keeps the existing company&apos;s value for anything the fresh data left blank. Ignore skips this lead and marks it
                    as a duplicate so it won&apos;t be offered for transfer again.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs font-normal">Only an Administrator can resolve a possible duplicate match.</p>
              )}
            </Alert>
          )}
        </Card>
      ))}

      {error && <p className="text-sm font-semibold text-danger">{error}</p>}

      <Button type="button" disabled={isPending} onClick={handleSubmit} variant="primary" className="px-5 py-2.5">
        {isPending ? "Transferring..." : `Transfer ${rows.length} lead(s)`}
      </Button>
    </div>
  );
}
