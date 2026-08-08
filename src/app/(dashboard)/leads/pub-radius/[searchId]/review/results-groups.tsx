"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePubRadiusResults, type PubRadiusSaveResult } from "./actions";
import { FieldCompare, type ExistingRecord } from "../../../competition-locator/[runId]/review/field-compare";
import { BUCKET_LABELS, type CompetitionLocatorBucket } from "@/lib/research/competition-locator-buckets";
import type { ScoredDuplicateMatch } from "@/lib/duplicates/scored-match";
import type { FieldDecision, MergeableTransferField } from "@/lib/companies/field-resolution";
import { Card, SectionHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";

// Fork of competition-locator/[runId]/review/results-groups.tsx: searchId
// instead of runId, points at savePubRadiusResults instead of
// saveCompetitionLocatorResults, and drops the competitorConflict
// state/resolution UI entirely — there is no competitor being assigned in
// this mode, so that bucket never populates (groupSearchResult() is reused
// unmodified, still mode-agnostic) and the controls would never mean
// anything. FieldCompare/BUCKET_LABELS/groupSearchResult are reused as-is
// from Competition Locator via direct cross-route import — both are already
// fully mode-agnostic (verified by reading them), no fork needed.

type ContactDataEntry = { firstName?: string; lastName?: string; phone?: string; email?: string; title?: string; note?: string };

export type ReviewRow = {
  id: string;
  bucket: CompetitionLocatorBucket;
  name: string;
  address1: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  contacts: ContactDataEntry[];
  score: number;
  explanation: string;
  evidence: { category: string; note: string; sourceUrl: string | null; verificationStatus: string; verifiedAt?: string | null }[];
  sources: { url: string; title: string | null }[];
  triviaStatus: string;
  disposition: string;
  rejectionReasonName: string | null;
  duplicateMatches: ScoredDuplicateMatch[];
  matchedCompany: {
    id: string;
    name: string;
    address1: string | null;
    city: string;
    region: string;
    postalCode: string | null;
    country: string;
    phone: string | null;
    email: string | null;
    websiteUrl: string | null;
    contactCount: number;
  } | null;
};

const BUCKET_ORDER: CompetitionLocatorBucket[] = ["new", "existingWithNewInfo", "possibleDuplicate", "competitorConflict", "rejectedUnverified"];

function toExistingRecord(row: ReviewRow): ExistingRecord {
  return {
    name: row.name,
    address1: row.address1,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    phone: row.phone,
    email: row.email,
    websiteUrl: row.websiteUrl,
  };
}

function matchedToExistingRecord(matched: NonNullable<ReviewRow["matchedCompany"]>): ExistingRecord {
  return {
    name: matched.name,
    address1: matched.address1,
    city: matched.city,
    region: matched.region,
    postalCode: matched.postalCode,
    country: matched.country,
    phone: matched.phone,
    email: matched.email,
    websiteUrl: matched.websiteUrl,
  };
}

export function ResultsGroups({
  searchId,
  rows,
  pipelineStages,
  salespeople,
  defaultStageId,
}: {
  searchId: string;
  rows: ReviewRow[];
  pipelineStages: { id: string; name: string }[];
  salespeople: { id: string; name: string }[];
  defaultStageId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fieldDecisionsByRow, setFieldDecisionsByRow] = useState<Record<string, Partial<Record<MergeableTransferField, FieldDecision>>>>({});
  const [duplicateResolutionByRow, setDuplicateResolutionByRow] = useState<Record<string, "create" | "merge" | "ignore">>({});
  const [assignedToId, setAssignedToId] = useState(salespeople[0]?.id ?? "");
  const [pipelineStageId, setPipelineStageId] = useState(defaultStageId);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Exclude<PubRadiusSaveResult, { error: string }> | null>(null);
  const [isPending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const map = new Map<CompetitionLocatorBucket, ReviewRow[]>();
    for (const bucket of BUCKET_ORDER) map.set(bucket, []);
    for (const row of rows) map.get(row.bucket)!.push(row);
    return map;
  }, [rows]);

  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function approveAll(bucket: CompetitionLocatorBucket) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of grouped.get(bucket) ?? []) next.add(row.id);
      return next;
    });
  }

  function handleFieldDecision(resultId: string, field: MergeableTransferField, decision: FieldDecision) {
    setFieldDecisionsByRow((prev) => ({ ...prev, [resultId]: { ...prev[resultId], [field]: decision } }));
  }

  function handleSave() {
    if (selected.size === 0) {
      setError("Select at least one result to save.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await savePubRadiusResults({
        searchId,
        assignedToId,
        pipelineStageId,
        rows: Array.from(selected).map((id) => {
          const row = rowsById.get(id)!;
          return {
            resultId: id,
            approved: true,
            fieldDecisions: fieldDecisionsByRow[id] ?? {},
            contacts: row.contacts,
            duplicateResolution:
              row.bucket === "existingWithNewInfo" || row.bucket === "possibleDuplicate" ? (duplicateResolutionByRow[id] ?? "merge") : undefined,
          };
        }),
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSummary(result);
      setSelected(new Set());
      router.refresh();
    });
  }

  if (summary) {
    return (
      <Card className="space-y-2">
        <SectionHeading>Saved</SectionHeading>
        <p className="text-sm text-text">
          {summary.createdCount} new compan{summary.createdCount === 1 ? "y" : "ies"} created, {summary.updatedCount} existing compan
          {summary.updatedCount === 1 ? "y" : "ies"} updated, {summary.skippedContactCount} duplicate contact
          {summary.skippedContactCount === 1 ? "" : "s"} skipped.
        </p>
        <Button type="button" variant="ghost" onClick={() => setSummary(null)}>
          Back to review
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-end gap-4">
        <div>
          <Label className="mb-1 block text-xs uppercase">Assign new companies to</Label>
          <Select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className="w-56">
            {salespeople.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs uppercase">Initial pipeline stage</Label>
          <Select value={pipelineStageId} onChange={(e) => setPipelineStageId(e.target.value)} className="w-56">
            {pipelineStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto flex flex-col items-end gap-2">
          {error && <p className="text-sm font-semibold text-danger">{error}</p>}
          <Button type="button" variant="primary" onClick={handleSave} disabled={isPending || selected.size === 0}>
            {isPending ? "Saving..." : `Save ${selected.size} approved result${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </Card>

      {BUCKET_ORDER.map((bucket) => {
        const bucketRows = grouped.get(bucket) ?? [];
        if (bucketRows.length === 0) return null;
        return (
          <Card key={bucket} className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionHeading>
                {BUCKET_LABELS[bucket]} ({bucketRows.length})
              </SectionHeading>
              {bucket !== "rejectedUnverified" && (
                <Button type="button" variant="ghost" onClick={() => approveAll(bucket)}>
                  Select all in section
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {bucketRows.map((row) => (
                <ResultRowCard
                  key={row.id}
                  row={row}
                  selected={selected.has(row.id)}
                  onToggle={() => toggle(row.id)}
                  fieldDecisions={fieldDecisionsByRow[row.id] ?? {}}
                  onFieldDecision={(field, decision) => handleFieldDecision(row.id, field, decision)}
                  duplicateResolution={duplicateResolutionByRow[row.id] ?? "merge"}
                  onDuplicateResolution={(value) => setDuplicateResolutionByRow((prev) => ({ ...prev, [row.id]: value }))}
                />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ResultRowCard({
  row,
  selected,
  onToggle,
  fieldDecisions,
  onFieldDecision,
  duplicateResolution,
  onDuplicateResolution,
}: {
  row: ReviewRow;
  selected: boolean;
  onToggle: () => void;
  fieldDecisions: Partial<Record<MergeableTransferField, FieldDecision>>;
  onFieldDecision: (field: MergeableTransferField, decision: FieldDecision) => void;
  duplicateResolution: "create" | "merge" | "ignore";
  onDuplicateResolution: (value: "create" | "merge" | "ignore") => void;
}) {
  const isRejected = row.bucket === "rejectedUnverified";
  const primarySource = row.sources[0]?.url ?? row.evidence.find((e) => e.sourceUrl)?.sourceUrl ?? null;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-3">
        {!isRejected && <input type="checkbox" className="mt-1" checked={selected} onChange={onToggle} />}
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-text">{row.name}</p>
            <Badge tone="neutral">Score {row.score}</Badge>
            {isRejected && row.rejectionReasonName && <Badge tone="danger">{row.rejectionReasonName}</Badge>}
          </div>
          <p className="text-sm text-text-muted">
            {[row.address1, row.city, row.region, row.postalCode, row.country].filter(Boolean).join(", ")}
          </p>
          <p className="text-sm text-text-muted">
            {[row.phone, row.email, row.websiteUrl].filter(Boolean).join(" · ")}
          </p>
          {row.contacts.length > 0 && (
            <ul className="mt-1 text-xs text-text-muted">
              {row.contacts.map((contact, index) => (
                <li key={index}>
                  {[contact.firstName, contact.lastName].filter(Boolean).join(" ")}
                  {contact.title ? ` — ${contact.title}` : ""}
                  {contact.email ? ` · ${contact.email}` : ""}
                  {contact.phone ? ` · ${contact.phone}` : ""}
                </li>
              ))}
            </ul>
          )}
          {primarySource && (
            <a href={primarySource} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-xs font-semibold text-secondary hover:underline">
              Open source
            </a>
          )}

          {(row.bucket === "existingWithNewInfo" || row.bucket === "possibleDuplicate") && row.matchedCompany && (
            <div className="mt-2 rounded-lg border border-border-strong bg-black/[0.02] p-2">
              <p className="text-xs font-semibold text-text">
                Possible match: {row.matchedCompany.name} ({row.matchedCompany.city}, {row.matchedCompany.region}) — {row.matchedCompany.contactCount} contact
                {row.matchedCompany.contactCount === 1 ? "" : "s"} on file
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Label className="text-xs uppercase text-text-muted">Action</Label>
                <Select
                  value={duplicateResolution}
                  onChange={(e) => onDuplicateResolution(e.target.value as typeof duplicateResolution)}
                  className="w-auto py-1 text-xs"
                >
                  <option value="merge">Merge into {row.matchedCompany.name}</option>
                  <option value="create">Create as a new company anyway</option>
                  <option value="ignore">Ignore — do nothing</option>
                </Select>
              </div>
              {duplicateResolution === "merge" && (
                <FieldCompare existing={matchedToExistingRecord(row.matchedCompany)} fresh={toExistingRecord(row)} decisions={fieldDecisions} onChange={onFieldDecision} />
              )}
            </div>
          )}

          {isRejected && <Alert tone="danger" className="mt-2">{row.explanation}</Alert>}
        </div>
      </div>
    </div>
  );
}
