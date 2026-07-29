"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import type { AnalyzeOpportunityResult } from "@/lib/companies/analyze-opportunity";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GRADE_TONE, GRADE_LABEL, WEEKDAY_LABEL } from "@/lib/ui/status-tones";

type Success = Exclude<AnalyzeOpportunityResult, { error: string }>;

type Row = {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  currentActivity?: string;
  // Set when the row starts running; paired with the panel's 1s ticker
  // (see `now` below) to show a live elapsed-time readout. stepCount is a
  // running tally of every progress event received so far — together
  // they're the "is this actually still working" signal a static single
  // activity line can't give during a long stretch between messages.
  startedAt?: number;
  stepCount: number;
  result?: Success;
  error?: string;
};

type StreamEvent = { type: "status"; message: string } | { type: "done"; result: Success } | { type: "error"; message: string };

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** One glanceable "is this venue already spoken for" signal — the whole
 * point of surfacing competitorFound as its own field instead of leaving it
 * buried in scoreExplanation/evidence prose. */
function CompetitorBadge({ result }: { result: Success }) {
  if (!result.competitorTriviaProvider) return null;
  const day = result.competitorTriviaDay ? WEEKDAY_LABEL[result.competitorTriviaDay] : null;
  return (
    <Badge tone="warning">
      {result.competitorTriviaProvider}
      {day ? ` · ${day}` : ""}
    </Badge>
  );
}

/**
 * Calls the streaming Route Handler (src/app/api/companies/[id]/
 * analyze-opportunity/route.ts) instead of a Server Action — a plain Server
 * Action held one HTTP request open with zero bytes transferred for the
 * whole call, which live got killed by Railway's proxy at its 5-minute
 * no-data idle timeout. Each line of the response is a real progress event
 * (an actual web_search/web_fetch call the model made, not a synthetic
 * timer) that both proves the request is alive and keeps bytes flowing so
 * Railway never treats the connection as idle.
 */
async function runStreamingAnalysis(companyId: string, onActivity: (message: string) => void): Promise<AnalyzeOpportunityResult> {
  const response = await fetch(`/api/companies/${companyId}/analyze-opportunity`, { method: "POST" });
  if (!response.ok || !response.body) {
    return { error: "The request failed before analysis could start." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: AnalyzeOpportunityResult = { error: "The connection ended before the analysis finished." };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "status") {
        onActivity(event.message);
      } else if (event.type === "done") {
        outcome = event.result;
      } else if (event.type === "error") {
        outcome = { error: event.message };
      }
    }
  }

  return outcome;
}

/**
 * Runs a deep AI opportunity analysis one company at a time across the
 * current selection, rendering each company's live activity and evidence as
 * soon as its own call resolves — a sequential for...of inside one
 * startTransition, not Promise.all, so progress is genuinely visible
 * company-by-company (and so checkAiBudget()'s mid-batch stop stays
 * meaningful).
 */
export function OpportunityAnalysisPanel({ companies, onClose }: { companies: { id: string; name: string }[]; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(companies.map((c) => ({ id: c.id, name: c.name, status: "pending", stepCount: 0 })));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  // Ticks once a second while anything is running, purely to force the
  // elapsed-time readout below to re-render — it's not itself a progress
  // signal (that still only ever comes from real onActivity messages), just
  // the clock those messages get measured against.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!started || finished) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [started, finished]);

  function updateRow(id: string, patch: Partial<Row> | ((prev: Row) => Partial<Row>)) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...(typeof patch === "function" ? patch(row) : patch) } : row)));
  }

  function runAnalysis() {
    setStarted(true);
    setFinished(false);
    startTransition(async () => {
      for (const row of rows) {
        updateRow(row.id, { status: "running", error: undefined, currentActivity: "Starting analysis...", startedAt: Date.now(), stepCount: 0 });
        const outcome = await runStreamingAnalysis(row.id, (message) =>
          updateRow(row.id, (prev) => ({ currentActivity: message, stepCount: prev.stepCount + 1 })),
        );
        if ("error" in outcome) {
          updateRow(row.id, { status: "error", error: outcome.error });
        } else {
          updateRow(row.id, { status: "done", result: outcome });
        }
      }
      setFinished(true);
    });
  }

  // Ranked by salesPriorityScore first, not eosTotal — that's the AI's own
  // holistic judgment (see AnalyzeOpportunityResult's doc comment), which is
  // what actually reflects a hard disqualifier (e.g. confirmed no TVs/
  // screens) even when unrelated category scores still look fine on their
  // own. Falls back to eosTotal only when a row has no priority score, and
  // uses eosTotal as a tiebreaker when priority scores are equal.
  const rankValue = (row: Row & { result: NonNullable<Row["result"]> }) => row.result.salesPriorityScore ?? row.result.eosTotal;
  const ranked = [...rows]
    .filter((row): row is Row & { status: "done"; result: NonNullable<Row["result"]> } => row.status === "done" && !!row.result)
    .sort((a, b) => rankValue(b) - rankValue(a) || b.result.eosTotal - a.result.eosTotal);

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {!started && (
        <>
          <p className="text-xs text-text-muted">
            Runs a deep AI research pass on {rows.length} compan{rows.length === 1 ? "y" : "ies"}, one at a time — fills in EOS category
            scores/evidence and flags anything that conflicts with existing data for review.
          </p>
          <div className="flex gap-2">
            <Button type="button" disabled={isPending} variant="primary" onClick={runAnalysis}>
              Start analysis
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {started && (
        <div className="space-y-2">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => (
              <li key={row.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={row.status !== "done"}
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    className="flex items-center gap-1 text-left font-semibold text-text disabled:cursor-default"
                  >
                    {row.status === "done" ? (
                      expanded === row.id ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )
                    ) : null}
                    {row.name}
                  </button>
                  <div className="flex items-center gap-2 text-xs">
                    {row.status === "pending" && <span className="text-text-muted">Waiting…</span>}
                    {row.status === "error" && <Badge tone="danger">Failed</Badge>}
                    {row.status === "done" && row.result && (
                      <>
                        <Badge tone={GRADE_TONE[row.result.opportunityGrade]}>{GRADE_LABEL[row.result.opportunityGrade]}</Badge>
                        <span className="font-bold text-text">{row.result.eosTotal}</span>
                        {row.result.hasTvs === false && <Badge tone="danger">No TVs</Badge>}
                        <CompetitorBadge result={row.result} />
                        {row.result.needsReview && <Badge tone="warning">Needs review</Badge>}
                      </>
                    )}
                  </div>
                </div>
                {row.status === "running" && (
                  <div className="mt-1 text-xs">
                    <p className="flex items-center gap-1.5 text-secondary">
                      <Loader2 size={14} className="shrink-0 animate-spin" />
                      {row.currentActivity ?? "Working…"}
                    </p>
                    <p className="mt-0.5 pl-[20px] text-text-muted">
                      {formatElapsed(now - (row.startedAt ?? now))} elapsed · {row.stepCount} step{row.stepCount === 1 ? "" : "s"} so far
                    </p>
                  </div>
                )}
                {row.status === "error" && row.error && <p className="mt-1 text-xs text-danger">{row.error}</p>}
                {row.status === "done" && row.result && expanded === row.id && (
                  <div className="mt-2 space-y-1 text-xs text-text-muted">
                    <p>
                      <span className="font-semibold text-text">Recommended next action: </span>
                      {row.result.recommendedNextAction}
                    </p>
                    {row.result.evidence.length === 0 ? (
                      <p>No evidence recorded.</p>
                    ) : (
                      <ul className="space-y-1">
                        {row.result.evidence.map((entry, index) => (
                          <li key={index}>
                            <span className="font-semibold text-text">[{entry.verificationStatus}]</span> {entry.evidenceSummary}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {finished && (
            <div className="space-y-2 rounded-lg border border-border-strong bg-black/[0.02] p-3">
              <p className="text-sm font-semibold text-text">Ranked: best to worst</p>
              {ranked.length === 0 ? (
                <Alert tone="warning">No company finished analysis successfully.</Alert>
              ) : (
                <ol className="space-y-1 text-sm">
                  {ranked.map((row, index) => (
                    <li key={row.id} className="flex items-center gap-2">
                      <span className="w-5 text-text-muted">{index + 1}.</span>
                      <span className="font-semibold text-text">{row.name}</span>
                      <Badge tone={GRADE_TONE[row.result.opportunityGrade]}>{GRADE_LABEL[row.result.opportunityGrade]}</Badge>
                      <span className="text-text-muted">EOS {row.result.eosTotal}</span>
                      {row.result.salesPriorityScore !== null && <span className="text-text-muted">· Priority {row.result.salesPriorityScore}</span>}
                      {row.result.hasTvs === false && <Badge tone="danger">No TVs</Badge>}
                      <CompetitorBadge result={row.result} />
                      {row.result.needsReview && <Badge tone="warning">Needs review</Badge>}
                    </li>
                  ))}
                </ol>
              )}
              <Button type="button" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
