"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus } from "lucide-react";
import { EOS_CATEGORY_MAXIMA, EOS_CATEGORY_LABELS } from "@/lib/eos/constants";
import { recordHistoricalScore } from "./actions";

const CATEGORY_KEYS = Object.keys(EOS_CATEGORY_MAXIMA) as (keyof typeof EOS_CATEGORY_MAXIMA)[];

const GRADE_LABELS: Record<string, string> = { A_PLUS: "A+", A: "A", B: "B", C: "C", D: "D" };
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
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900">{value || <span className="text-slate-400">—</span>}</p>
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
  const [categoryValues, setCategoryValues] = useState<Record<string, number>>(
    Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0])),
  );

  const total = useMemo(() => CATEGORY_KEYS.reduce((sum, key) => sum + (categoryValues[key] || 0), 0), [categoryValues]);

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

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

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">EOS-1.0 Score</h2>
        {canEdit && !recording && (
          <button type="button" onClick={() => setRecording(true)} className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline">
            <CirclePlus size={15} />
            Record a score
          </button>
        )}
      </div>

      {summary.eosScore === null ? (
        <p className="mt-3 text-sm text-slate-500">No score recorded yet.</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="EOS score" value={`${summary.eosScore} / 100`} />
          <Field label="Grade" value={summary.opportunityGrade ? GRADE_LABELS[summary.opportunityGrade] : null} />
          <Field label="Confidence" value={summary.confidenceLevel} />
          <Field
            label="Primary classification"
            value={summary.primaryClassification ? CLASSIFICATION_LABELS[summary.primaryClassification] : null}
          />
          <Field label="Secondary tags" value={summary.secondaryTags.join(", ")} />
          <Field label="Sales priority score" value={summary.salesPriorityScore} />
          <Field label="Scoring version" value={summary.scoringVersion} />
          <Field label="Last scored" value={summary.lastScoredAt ? new Date(summary.lastScoredAt).toLocaleString() : null} />
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            {summary.isExistingCustomer && (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Existing customer</span>
            )}
            {summary.isQualified && (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Qualified</span>
            )}
            {summary.doNotContact && (
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">Do not contact</span>
            )}
          </div>
          {summary.scoreExplanation && <Field label="Explanation" value={summary.scoreExplanation} />}
          {summary.recommendedSalesApproach && <Field label="Recommended approach" value={summary.recommendedSalesApproach} />}
          {summary.recommendedNextAction && <Field label="Recommended next action" value={summary.recommendedNextAction} />}
        </div>
      )}

      {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}

      {recording && (
        <form action={handleRecord} className="mt-4 space-y-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {CATEGORY_KEYS.map((key) => (
              <div key={key}>
                <label className="text-xs font-semibold text-slate-600">
                  {EOS_CATEGORY_LABELS[key]} (0–{EOS_CATEGORY_MAXIMA[key]})
                </label>
                <input
                  name={key}
                  type="number"
                  min={0}
                  max={EOS_CATEGORY_MAXIMA[key]}
                  defaultValue={0}
                  required
                  onChange={(event) =>
                    setCategoryValues((prev) => ({ ...prev, [key]: Number(event.target.value) || 0 }))
                  }
                  className={inputClass}
                />
              </div>
            ))}
          </div>
          <p className="text-sm font-bold">
            Total: {total} / 100 <span className="font-normal text-slate-500">(calculated from categories above)</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-slate-600">Confidence</label>
              <select name="confidenceLevel" required defaultValue="MEDIUM" className={inputClass}>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Primary classification</label>
              <select name="primaryClassification" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Choose one
                </option>
                {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600">Secondary tags</label>
            <div className="mt-1 flex flex-wrap gap-4">
              {["EASY_WIN", "REVENUE_READY", "NO_HOST_READY"].map((tag) => (
                <label key={tag} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="secondaryTags" value={tag} />
                  {tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input name="salesPriorityScore" type="number" min={0} placeholder="Sales priority score (optional)" className={inputClass} />
            <input name="scoringVersion" placeholder="Scoring version (e.g. manual-1.0)" required className={inputClass} />
          </div>

          <textarea name="scoreExplanation" placeholder="Score explanation" rows={2} className={inputClass} />
          <textarea name="verifiedEvidenceSummary" placeholder="Verified evidence summary" rows={2} className={inputClass} />
          <textarea name="inferredEvidenceSummary" placeholder="Inferred evidence summary" rows={2} className={inputClass} />
          <textarea name="missingInformation" placeholder="Missing information" rows={2} className={inputClass} />
          <textarea name="recommendedSalesApproach" placeholder="Recommended sales approach" rows={2} className={inputClass} />
          <textarea name="recommendedNextAction" placeholder="Recommended next action" rows={2} className={inputClass} />

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <input type="checkbox" name="isExistingCustomer" />
              Existing customer
            </label>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <input type="checkbox" name="isQualified" />
              Qualified
            </label>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <input type="checkbox" name="doNotContact" />
              Do not contact
            </label>
          </div>
          <input name="exclusionReason" placeholder="Exclusion reason (if any)" className={inputClass} />

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              {isPending ? "Saving..." : "Save score"}
            </button>
            <button type="button" onClick={() => setRecording(false)} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold">
              Cancel
            </button>
          </div>
        </form>
      )}

      {history.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">{history.length} historical score(s)</summary>
          <ul className="mt-2 space-y-2">
            {history.map((record) => (
              <li key={record.id} className="rounded-lg border border-slate-100 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{record.eosTotal} / 100</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    {GRADE_LABELS[record.opportunityGrade] ?? record.opportunityGrade}
                  </span>
                  <span className="text-xs text-slate-400">{CLASSIFICATION_LABELS[record.primaryClassification]}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(record.scoredAt).toLocaleString()} · {record.scoredBy?.name ?? "Unknown"} · v{record.scoringVersion}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
