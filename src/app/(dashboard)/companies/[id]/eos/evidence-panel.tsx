"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus } from "lucide-react";
import { addEvidence } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/field";
import { VERIFICATION_TONE as VERIFICATION_TONE_MAP } from "@/lib/ui/status-tones";

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

export function EvidencePanel({ companyId, evidence, canEdit }: { companyId: string; evidence: EvidenceRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-accent">Evidence</h2>
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline">
            <CirclePlus size={15} />
            Add evidence
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-danger">{error}</p>}

      {adding && (
        <form action={handleCreate} className="mt-3 space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
          <Select name="category" required defaultValue="" className="py-1.5">
            <option value="" disabled>
              Scoring category
            </option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Textarea name="evidenceSummary" placeholder="Evidence summary" required rows={2} className="py-1.5" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input name="sourceType" placeholder="Source type (e.g. website, review)" className="py-1.5" />
            <Input name="sourceUrl" placeholder="Source URL" className="py-1.5" />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input name="evidenceDate" type="date" className="py-1.5" />
            <Select name="verificationStatus" required defaultValue="UNVERIFIED" className="py-1.5">
              <option value="VERIFIED">Verified</option>
              <option value="INFERRED">Inferred</option>
              <option value="UNVERIFIED">Unverified</option>
              <option value="OUTDATED">Outdated</option>
              <option value="CONTRADICTORY">Contradictory</option>
            </Select>
            <Select name="reliability" required defaultValue="MEDIUM" className="py-1.5">
              <option value="HIGH">High reliability</option>
              <option value="MEDIUM">Medium reliability</option>
              <option value="LOW">Low reliability</option>
            </Select>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50">
              {isPending ? "Saving..." : "Add evidence"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5">
              Cancel
            </button>
          </div>
        </form>
      )}

      {evidence.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">No evidence recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {evidence.map((item) => (
            <li key={item.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-text">{CATEGORY_LABELS[item.category] ?? item.category}</span>
                <Badge tone={VERIFICATION_TONE_MAP[item.verificationStatus] ?? "neutral"}>{item.verificationStatus}</Badge>
                <span className="text-xs text-text-muted">{item.reliability} reliability</span>
              </div>
              <p className="mt-1 text-text">{item.evidenceSummary}</p>
              <p className="mt-1 text-xs text-text-muted">
                {[item.sourceType, item.sourceUrl].filter(Boolean).join(" · ")}
                {item.evidenceDate && ` · ${new Date(item.evidenceDate).toLocaleDateString()}`}
                {` · added by ${item.createdBy.name}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
