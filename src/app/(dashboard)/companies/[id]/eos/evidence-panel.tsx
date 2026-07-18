"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus } from "lucide-react";
import { addEvidence } from "./actions";

export type EvidenceRow = {
  id: string;
  category: string;
  sourceType: string | null;
  sourceUrl: string | null;
  evidenceSummary: string;
  evidenceDate: Date | null;
  verificationStatus: string;
  reliability: string;
  createdBy: { name: string };
  createdAt: Date;
};

const CATEGORY_LABELS: Record<string, string> = {
  FOOD_BEVERAGE_FOCUS: "Food and beverage focus",
  WEEKNIGHT_REVENUE_OPPORTUNITY: "Weeknight revenue opportunity",
  COMMUNITY_ENGAGEMENT: "Community engagement",
  EXISTING_EVENT_CULTURE: "Existing event culture",
  GROUP_SEATING_LAYOUT: "Group seating and layout",
  CAPACITY_OPERATIONAL_SUITABILITY: "Capacity and operational suitability",
  DECISION_MAKER_ACCESSIBILITY: "Decision-maker accessibility",
  MARKETING_ACTIVITY_VISIBILITY: "Marketing activity and public visibility",
  TURNKEY_IMPLEMENTATION_READINESS: "Turnkey implementation readiness",
  COMPETITIVE_OPPORTUNITY: "Competitive opportunity",
};

const VERIFICATION_TONE: Record<string, string> = {
  VERIFIED: "bg-emerald-50 text-emerald-700",
  INFERRED: "bg-blue-50 text-blue-700",
  UNVERIFIED: "bg-slate-100 text-slate-600",
  OUTDATED: "bg-amber-50 text-amber-700",
  CONTRADICTORY: "bg-red-50 text-red-700",
};

export function EvidencePanel({ companyId, evidence, canEdit }: { companyId: string; evidence: EvidenceRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await addEvidence(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setAdding(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Evidence</h2>
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline">
            <CirclePlus size={15} />
            Add evidence
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}

      {adding && (
        <form action={handleCreate} className="mt-3 space-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
          <select name="category" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Scoring category
            </option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <textarea name="evidenceSummary" placeholder="Evidence summary" required rows={2} className={inputClass} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="sourceType" placeholder="Source type (e.g. website, review)" className={inputClass} />
            <input name="sourceUrl" placeholder="Source URL" className={inputClass} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input name="evidenceDate" type="date" className={inputClass} />
            <select name="verificationStatus" required defaultValue="UNVERIFIED" className={inputClass}>
              <option value="VERIFIED">Verified</option>
              <option value="INFERRED">Inferred</option>
              <option value="UNVERIFIED">Unverified</option>
              <option value="OUTDATED">Outdated</option>
              <option value="CONTRADICTORY">Contradictory</option>
            </select>
            <select name="reliability" required defaultValue="MEDIUM" className={inputClass}>
              <option value="HIGH">High reliability</option>
              <option value="MEDIUM">Medium reliability</option>
              <option value="LOW">Low reliability</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">
              {isPending ? "Saving..." : "Add evidence"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
              Cancel
            </button>
          </div>
        </form>
      )}

      {evidence.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No evidence recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {evidence.map((item) => (
            <li key={item.id} className="rounded-lg border border-slate-100 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{CATEGORY_LABELS[item.category] ?? item.category}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${VERIFICATION_TONE[item.verificationStatus] ?? "bg-slate-100 text-slate-600"}`}>
                  {item.verificationStatus}
                </span>
                <span className="text-xs text-slate-400">{item.reliability} reliability</span>
              </div>
              <p className="mt-1 text-slate-700">{item.evidenceSummary}</p>
              <p className="mt-1 text-xs text-slate-400">
                {[item.sourceType, item.sourceUrl].filter(Boolean).join(" · ")}
                {item.evidenceDate && ` · ${new Date(item.evidenceDate).toLocaleDateString()}`}
                {` · added by ${item.createdBy.name}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
