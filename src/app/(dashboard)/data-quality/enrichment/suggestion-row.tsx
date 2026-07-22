"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { toneFor, CONFIDENCE_TONE, CONFIDENCE_LABEL, ENRICHMENT_DECISION_TONE, humanizeEnum } from "@/lib/ui/status-tones";
import { acceptEnrichmentSuggestion, rejectEnrichmentSuggestion } from "./actions";

export type SuggestionRow = {
  id: string;
  field: string;
  previousValue: string | null;
  suggestedValue: string;
  provider: string;
  sourceUrl: string | null;
  evidence: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  decision: "PENDING" | "ACCEPTED" | "REJECTED";
  recordHref: string | null;
  recordLabel: string;
};

export function SuggestionRowItem({ suggestion }: { suggestion: SuggestionRow }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={toneFor(CONFIDENCE_TONE, suggestion.confidence)}>{CONFIDENCE_LABEL[suggestion.confidence] ?? suggestion.confidence}</Badge>
        <Badge tone={toneFor(ENRICHMENT_DECISION_TONE, suggestion.decision)}>{humanizeEnum(suggestion.decision)}</Badge>
        <span className="text-xs text-text-muted">{suggestion.field}</span>
      </div>
      <p className="mt-1 text-sm">
        {suggestion.recordHref ? (
          <Link href={suggestion.recordHref} className="font-semibold text-secondary hover:underline">
            {suggestion.recordLabel}
          </Link>
        ) : (
          <span className="font-semibold">{suggestion.recordLabel}</span>
        )}
      </p>
      <p className="mt-1 text-sm text-text">
        <span className="text-text-muted">Current:</span> {suggestion.previousValue || <span className="text-text-muted">(blank)</span>} <span className="text-text-muted">→ Suggested:</span> {suggestion.suggestedValue}
      </p>
      <p className="mt-1 text-xs text-text-muted">{suggestion.evidence}</p>
      {suggestion.sourceUrl && (
        <a href={suggestion.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-secondary hover:underline">
          Source
        </a>
      )}

      {suggestion.decision === "PENDING" && (
        <div className="mt-2 flex gap-3 text-xs">
          <button
            type="button"
            className="font-semibold text-secondary hover:underline"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                if (!window.confirm(`Apply "${suggestion.suggestedValue}" to ${suggestion.field}?`)) return;
                await acceptEnrichmentSuggestion(suggestion.id);
                router.refresh();
              })
            }
          >
            Accept
          </button>
          <button
            type="button"
            className="font-semibold text-text-muted hover:underline"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await rejectEnrichmentSuggestion(suggestion.id);
                router.refresh();
              })
            }
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
