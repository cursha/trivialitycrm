"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus } from "lucide-react";
import { EOS_CATEGORY_MAXIMA, EOS_CATEGORY_LABELS } from "@/lib/eos/constants";
import { recordHistoricalScore, clearNeedsReview, setHasTvs } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input, Select, Textarea } from "@/components/ui/field";
import { GRADE_TONE, GRADE_LABEL, CLASSIFICATION_TONE } from "@/lib/ui/status-tones";

const CATEGORY_KEYS = Object.keys(EOS_CATEGORY_MAXIMA) as (keyof typeof EOS_CATEGORY_MAXIMA)[];

const CLASSIFICATION_LABELS: Record<string, string> = {
  ENTERTAINMENT_READY: "Entertainment-Ready",
  GREENFIELD: "Greenfield",
  REPLACEMENT: "Replacement",
  NEEDS_QUALIFICATION: "Needs Qualification",
  EXISTING_CUSTOMER: "Existing Customer",
};

export type CompanySummary = {
  eosScore: number | null;
  opportunityGrade: string | null;
  confidenceLevel: string | null;
  primaryClassification: string | null;
  secondaryTags: string[];
  salesPriorityScore: number | null;
  scoreExplanation: string | null;
  recommendedSalesApproach: string | null;
  recommendedNextAction: string | null;
  lastScoredAt: Date | null;
  scoringVersion: string | null;
  isExistingCustomer: boolean;
  isQualified: boolean;
  doNotContact: boolean;
  exclusionReason: string | null;
  needsReview: boolean;
  needsReviewReason: string | null;
  hasTvs: boolean | null;
};

export type ScoreHistoryRow = {
  id: string;
  eosTotal: number;
  opportunityGrade: string;
  confidenceLevel: string;
  primaryClassification: string;
  scoringVersion: string;
  scoredAt: Date;
  scoredBy: { name: string } | null;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-text">{value || <span className="text-text-muted">—</span>}</p>
    </div>
  );
}

export function ScorePanel({
  companyId,
  summary,
  history,
  canEdit,
}: {
  companyId: string;
  summary: CompanySummary;
  history: ScoreHistoryRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isClearingReview, startClearReview] = useTransition();
  const [isSettingHasTvs, startSetHasTvs] = useTransition();
  const [categoryValues, setCategoryValues] = useState<Record<string, number>>(
    Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0])),
  );

  const total = useMemo(() => CATEGORY_KEYS.reduce((sum, key) => sum + (categoryValues[key] || 0), 0), [categoryValues]);

  function handleRecord(formData: FormData) {
    startTransition(async () => {
      const result = await recordHistoricalScore(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setRecording(false);
        router.refresh();
      }
    });
  }

  function handleSetHasTvs(value: boolean | null) {
    startSetHasTvs(async () => {
      await setHasTvs(companyId, value);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-accent">EOS-1.0 Score</h2>
        {canEdit && !recording && (
          <button type="button" onClick={() => setRecording(true)} className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline">
            <CirclePlus size={15} />
            Record a score
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Has TVs</span>
        {canEdit ? (
          <div className="flex gap-1">
            {(
              [
                { label: "Yes", value: true },
                { label: "No", value: false },
                { label: "Unknown", value: null },
              ] as const
            ).map((option) => (
              <button
                key={option.label}
                type="button"
                disabled={isSettingHasTvs}
                onClick={() => handleSetHasTvs(option.value)}
                className={`rounded px-2 py-1 text-xs font-semibold disabled:pointer-events-none disabled:opacity-50 ${
                  summary.hasTvs === option.value ? "bg-primary text-white" : "border border-border-strong text-text hover:bg-black/5"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <Badge tone={summary.hasTvs === false ? "danger" : "neutral"}>{summary.hasTvs === null ? "Unknown" : summary.hasTvs ? "Yes" : "No"}</Badge>
        )}
      </div>

      {summary.needsReview && (
        <Alert tone="warning" className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-bold">Needs review</span>
              {summary.needsReviewReason ? ` — ${summary.needsReviewReason}` : ""}
            </span>
            {canEdit && (
              <button
                type="button"
                disabled={isClearingReview}
                onClick={() =>
                  startClearReview(async () => {
                    await clearNeedsReview(companyId);
                    router.refresh();
                  })
                }
                className="font-bold text-secondary hover:underline disabled:pointer-events-none disabled:opacity-50"
              >
                Mark reviewed
              </button>
            )}
          </div>
        </Alert>
      )}

      {summary.eosScore === null ? (
        <p className="mt-3 text-sm text-text-muted">No score recorded yet.</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="EOS score" value={`${summary.eosScore} / 100`} />
          <Field
            label="Grade"
            value={summary.opportunityGrade ? <Badge tone={GRADE_TONE[summary.opportunityGrade]}>{GRADE_LABEL[summary.opportunityGrade]}</Badge> : null}
          />
          <Field label="Confidence" value={summary.confidenceLevel} />
          <Field
            label="Primary classification"
            value={
              summary.primaryClassification ? (
                <Badge tone={CLASSIFICATION_TONE[summary.primaryClassification]}>{CLASSIFICATION_LABELS[summary.primaryClassification]}</Badge>
              ) : null
            }
          />
          <Field label="Secondary tags" value={summary.secondaryTags.join(", ")} />
          <Field label="Sales priority score" value={summary.salesPriorityScore} />
          <Field label="Scoring version" value={summary.scoringVersion} />
          <Field label="Last scored" value={summary.lastScoredAt ? new Date(summary.lastScoredAt).toLocaleString() : null} />
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            {summary.isExistingCustomer && <Badge tone="secondary">Existing customer</Badge>}
            {summary.isQualified && <Badge tone="success">Qualified</Badge>}
            {summary.doNotContact && <Badge tone="danger">Do not contact</Badge>}
          </div>
          {summary.scoreExplanation && <Field label="Explanation" value={summary.scoreExplanation} />}
          {summary.recommendedSalesApproach && <Field label="Recommended approach" value={summary.recommendedSalesApproach} />}
          {summary.recommendedNextAction && <Field label="Recommended next action" value={summary.recommendedNextAction} />}
        </div>
      )}

      {error && <p className="mt-3 text-xs font-semibold text-danger">{error}</p>}

      {recording && (
        <form action={handleRecord} className="mt-4 space-y-3 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {CATEGORY_KEYS.map((key) => (
              <div key={key}>
                <label className="text-xs font-semibold text-text-muted">
                  {EOS_CATEGORY_LABELS[key]} (0–{EOS_CATEGORY_MAXIMA[key]})
                </label>
                <Input
                  name={key}
                  type="number"
                  min={0}
                  max={EOS_CATEGORY_MAXIMA[key]}
                  defaultValue={0}
                  required
                  onChange={(event) =>
                    setCategoryValues((prev) => ({ ...prev, [key]: Number(event.target.value) || 0 }))
                  }
                  className="py-1.5"
                />
              </div>
            ))}
          </div>
          <p className="text-sm font-bold text-text">
            Total: {total} / 100 <span className="font-normal text-text-muted">(calculated from categories above)</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-text-muted">Confidence</label>
              <Select name="confidenceLevel" required defaultValue="MEDIUM" className="py-1.5">
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted">Primary classification</label>
              <Select name="primaryClassification" required defaultValue="" className="py-1.5">
                <option value="" disabled>
                  Choose one
                </option>
                {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-text-muted">Secondary tags</label>
            <div className="mt-1 flex flex-wrap gap-4">
              {["EASY_WIN", "REVENUE_READY", "NO_HOST_READY"].map((tag) => (
                <label key={tag} className="flex items-center gap-1.5 text-sm text-text">
                  <input type="checkbox" name="secondaryTags" value={tag} />
                  {tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="salesPriorityScore" type="number" min={0} placeholder="Sales priority score (optional)" className="py-1.5" />
            <Input name="scoringVersion" placeholder="Scoring version (e.g. manual-1.0)" required className="py-1.5" />
          </div>

          <Textarea name="scoreExplanation" placeholder="Score explanation" rows={2} className="py-1.5" />
          <Textarea name="verifiedEvidenceSummary" placeholder="Verified evidence summary" rows={2} className="py-1.5" />
          <Textarea name="inferredEvidenceSummary" placeholder="Inferred evidence summary" rows={2} className="py-1.5" />
          <Textarea name="missingInformation" placeholder="Missing information" rows={2} className="py-1.5" />
          <Textarea name="recommendedSalesApproach" placeholder="Recommended sales approach" rows={2} className="py-1.5" />
          <Textarea name="recommendedNextAction" placeholder="Recommended next action" rows={2} className="py-1.5" />

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <input type="checkbox" name="isExistingCustomer" />
              Existing customer
            </label>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <input type="checkbox" name="isQualified" />
              Qualified
            </label>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <input type="checkbox" name="doNotContact" />
              Do not contact
            </label>
          </div>
          <Input name="exclusionReason" placeholder="Exclusion reason (if any)" className="py-1.5" />

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50">
              {isPending ? "Saving..." : "Save score"}
            </button>
            <button type="button" onClick={() => setRecording(false)} className="rounded border border-border-strong px-4 py-2 text-sm font-semibold text-text hover:bg-black/5">
              Cancel
            </button>
          </div>
        </form>
      )}

      {history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-text-muted">{history.length} historical score(s)</summary>
          <ul className="mt-2 space-y-2">
            {history.map((record) => (
              <li key={record.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-text">{record.eosTotal} / 100</span>
                  <Badge tone={GRADE_TONE[record.opportunityGrade]}>{GRADE_LABEL[record.opportunityGrade] ?? record.opportunityGrade}</Badge>
                  <span className="text-xs text-text-muted">{CLASSIFICATION_LABELS[record.primaryClassification]}</span>
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {new Date(record.scoredAt).toLocaleString()} · {record.scoredBy?.name ?? "Unknown"} · v{record.scoringVersion}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
