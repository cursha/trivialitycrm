"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { rejectResult, restoreResult, researchResult } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { TRIVIA_STATUS_TONE, DISPOSITION_TONE, DISPOSITION_LABEL, humanizeEnum, type BadgeTone } from "@/lib/ui/status-tones";
import { isMockResearchResult, computeResultConfidence, recommendResultNextAction } from "@/lib/research/result-explanation";

export type ResultRow = {
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
  score: number;
  explanation: string;
  evidence: { category: string; note: string; sourceUrl: string | null; verificationStatus: string }[];
  sources: { url: string; title: string | null }[];
  triviaStatus: string;
  disposition: string;
  competitorName: string | null;
  rejectionReasonName: string | null;
  researchedAt: string;
};

const CONFIDENCE_TONE: Record<string, BadgeTone> = {
  HIGH: "success",
  MEDIUM: "warning",
  LOW: "neutral",
};

/** The evidence/score-explanation panel shown when a result row is
 * expanded — factored out so the desktop table row and the mobile card
 * layout can share it instead of duplicating the markup. */
function ResultEvidencePanel({ result, minimumScore }: { result: ResultRow; minimumScore: number }) {
  return (
    <div>
      {isMockResearchResult(result.explanation, result.evidence) && (
        <Badge tone="warning" className="mb-2">
          Mock data — not a real researched lead
        </Badge>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-text-muted">
        <span className="flex items-center gap-1">
          Confidence:
          <Badge tone={CONFIDENCE_TONE[computeResultConfidence(result.evidence)]}>
            {humanizeEnum(computeResultConfidence(result.evidence))}
          </Badge>
        </span>
        <span>
          Evidence: {result.evidence.length} item{result.evidence.length === 1 ? "" : "s"}
        </span>
        <span>Last evaluated: {new Date(result.researchedAt).toLocaleString()}</span>
      </div>
      <p className="text-sm font-semibold text-text">Score explanation</p>
      <p className="mb-3 text-sm text-text-muted">{result.explanation}</p>
      <p className="text-sm font-semibold text-text">Recommended next action</p>
      <p className="mb-3 text-sm text-text-muted">
        {recommendResultNextAction({
          disposition: result.disposition,
          score: result.score,
          minimumScore,
          triviaStatus: result.triviaStatus,
          evidenceCount: result.evidence.length,
        })}
      </p>
      <p className="text-sm font-semibold text-text">Evidence</p>
      {result.evidence.length === 0 ? (
        <p className="text-sm text-text-muted">No evidence recorded.</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm text-text-muted">
          {result.evidence.map((entry, index) => (
            <li key={index}>
              <span className="font-semibold text-text">[{entry.verificationStatus}]</span> {entry.note}
              {entry.sourceUrl && (
                <a href={entry.sourceUrl} target="_blank" rel="noreferrer noopener" className="ml-1 text-secondary hover:underline">
                  source
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm font-semibold text-text">Sources</p>
      {result.sources.length === 0 ? (
        <p className="text-sm text-text-muted">No sources recorded.</p>
      ) : (
        <ul className="space-y-1 text-sm text-secondary">
          {result.sources.map((source, index) => (
            <li key={index}>
              <a href={source.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                {source.title ?? source.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The research/restore/reject action controls for one result — shared
 * between the desktop table's actions cell and the mobile card layout. */
function ResultActions({
  result,
  canResearch,
  canRestore,
  rejectionReasons,
  isPending,
  onResearch,
  onRestore,
  onReject,
}: {
  result: ResultRow;
  canResearch: boolean;
  canRestore: boolean;
  rejectionReasons: { id: string; name: string }[];
  isPending: boolean;
  onResearch: () => void;
  onRestore: () => void;
  onReject: (reasonId: string) => void;
}) {
  return (
    <>
      {canResearch && (
        <button
          type="button"
          disabled={isPending}
          title="Runs an AI web-research pass on just this business — trivia status, evidence, and a fresh score."
          onClick={onResearch}
          className="mr-1 inline-flex items-center gap-1 rounded bg-black/5 px-2 py-1 text-xs font-semibold text-text hover:bg-secondary/10 hover:text-secondary"
        >
          <Sparkles size={12} />
          Research this business
        </button>
      )}
      {result.disposition === "REJECTED" && canRestore && (
        <button
          type="button"
          disabled={isPending}
          onClick={onRestore}
          className="rounded bg-black/5 px-2 py-1 text-xs font-semibold text-text hover:bg-emerald-50 hover:text-emerald-700"
        >
          Restore
        </button>
      )}
      {result.disposition !== "REJECTED" && rejectionReasons.length > 0 && (
        <select
          defaultValue=""
          disabled={isPending}
          onChange={(event) => {
            const reasonId = event.target.value;
            if (reasonId) onReject(reasonId);
          }}
          className="rounded border border-border-strong px-2 py-1 text-xs text-text"
        >
          <option value="">Reject...</option>
          {rejectionReasons.map((reason) => (
            <option key={reason.id} value={reason.id}>
              {reason.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

export function ResultsTable({
  results,
  rejectionReasons,
  canRestore,
  canViewEvidence,
  canTransfer,
  canExport,
  canResearch,
  view,
  sort,
  page,
  pageSize,
  total,
  searchId,
  minimumScore,
}: {
  results: ResultRow[];
  rejectionReasons: { id: string; name: string }[];
  canRestore: boolean;
  canViewEvidence: boolean;
  canTransfer: boolean;
  canExport: boolean;
  canResearch: boolean;
  view: string;
  sort: string;
  page: number;
  pageSize: number;
  total: number;
  searchId: string;
  minimumScore: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [researchErrors, setResearchErrors] = useState<Record<string, string>>({});
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function setResearchError(id: string, message: string | null) {
    setResearchErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  const selectableIds = results.filter((r) => r.disposition === "NEW" || r.disposition === "REVIEWED").map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goto(params: Record<string, string>) {
    const search = new URLSearchParams({ view, sort, page: String(page), ...params });
    router.push(`/leads/searches/${searchId}/results?${search.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => goto({ view: "default", page: "1" })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === "default" ? "bg-secondary text-white" : "bg-black/5 text-text-muted"}`}
          >
            Meets minimum score
          </button>
          <button
            type="button"
            onClick={() => goto({ view: "all", page: "1" })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === "all" ? "bg-secondary text-white" : "bg-black/5 text-text-muted"}`}
          >
            All results
          </button>
          <button
            type="button"
            onClick={() => goto({ sort: sort === "score_desc" ? "score_asc" : "score_desc" })}
            className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-text-muted"
          >
            Score: {sort === "score_desc" ? "High to low" : "Low to high"}
          </button>
        </div>

        <div className="flex gap-2">
          {canExport && (
            <>
              <a
                href={`/api/export/search-results?searchId=${searchId}&view=${view}&format=csv`}
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-text hover:bg-black/5"
              >
                Export CSV
              </a>
              <a
                href={`/api/export/search-results?searchId=${searchId}&view=${view}&format=xlsx`}
                className="rounded-lg border border-border-strong px-3 py-2 text-xs font-semibold text-text hover:bg-black/5"
              >
                Export Excel
              </a>
            </>
          )}
          {canTransfer && (
            <Link
              href={selected.size > 0 ? `/leads/transfer?ids=${Array.from(selected).join(",")}` : "#"}
              aria-disabled={selected.size === 0}
              className={`rounded-lg px-4 py-2 text-sm font-bold text-white ${
                selected.size > 0 ? "bg-primary hover:bg-primary-hover" : "pointer-events-none bg-border-strong"
              }`}
            >
              Transfer selected ({selected.size})
            </Link>
          )}
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-xs uppercase text-text-muted">
            <tr>
              <th className="px-4 py-3">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all on this page" />
              </th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Trivia status</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Disposition</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <Fragment key={result.id}>
                <tr className="border-t border-border">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      disabled={!(result.disposition === "NEW" || result.disposition === "REVIEWED")}
                      checked={selected.has(result.id)}
                      onChange={() => toggleOne(result.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === result.id ? null : result.id)}
                      className="flex items-center gap-1 font-semibold text-text hover:text-secondary"
                    >
                      {expanded === result.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {result.name}
                    </button>
                    {result.competitorName && <p className="mt-0.5 text-xs text-amber-700">Uses {result.competitorName}</p>}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {result.city}, {result.region}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={TRIVIA_STATUS_TONE[result.triviaStatus]}>{humanizeEnum(result.triviaStatus)}</Badge>
                    {result.triviaStatus === "UNCERTAIN" && result.evidence.length === 0 && (
                      <p className="mt-0.5 text-xs text-text-muted">Not yet researched</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold text-text">{result.score}</td>
                  <td className="px-4 py-3">
                    <Badge tone={DISPOSITION_TONE[result.disposition]}>{DISPOSITION_LABEL[result.disposition] ?? result.disposition}</Badge>
                    {result.rejectionReasonName && <span className="ml-1 text-text-muted">— {result.rejectionReasonName}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ResultActions
                      result={result}
                      canResearch={canResearch}
                      canRestore={canRestore}
                      rejectionReasons={rejectionReasons}
                      isPending={isPending}
                      onResearch={() =>
                        startTransition(async () => {
                          setResearchError(result.id, null);
                          const outcome = await researchResult(result.id);
                          if (outcome?.error) setResearchError(result.id, outcome.error);
                        })
                      }
                      onRestore={() =>
                        startTransition(() => {
                          void restoreResult(result.id);
                        })
                      }
                      onReject={(reasonId) =>
                        startTransition(() => {
                          void rejectResult(result.id, reasonId);
                        })
                      }
                    />
                  </td>
                </tr>
                {researchErrors[result.id] && (
                  <tr className="border-t-0">
                    <td colSpan={7} className="bg-danger/5 px-4 py-2 text-right text-xs font-semibold text-danger">
                      {researchErrors[result.id]}
                    </td>
                  </tr>
                )}
                {expanded === result.id && canViewEvidence && (
                  <tr className="border-t border-border bg-black/[0.02]">
                    <td colSpan={7} className="px-4 py-4">
                      <ResultEvidencePanel result={result} minimumScore={minimumScore} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-text-muted">
                  No results in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        <ul className="divide-y divide-border md:hidden">
          {results.map((result) => (
            <li key={result.id} className="p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0"
                  disabled={!(result.disposition === "NEW" || result.disposition === "REVIEWED")}
                  checked={selected.has(result.id)}
                  onChange={() => toggleOne(result.id)}
                  aria-label={`Select ${result.name}`}
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === result.id ? null : result.id)}
                    className="flex items-center gap-1 text-left font-semibold text-text hover:text-secondary"
                  >
                    {expanded === result.id ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                    {result.name}
                  </button>
                  {result.competitorName && <p className="mt-0.5 text-xs text-amber-700">Uses {result.competitorName}</p>}
                  <p className="text-xs text-text-muted">
                    {result.city}, {result.region}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone={TRIVIA_STATUS_TONE[result.triviaStatus]}>{humanizeEnum(result.triviaStatus)}</Badge>
                    <Badge tone={DISPOSITION_TONE[result.disposition]}>{DISPOSITION_LABEL[result.disposition] ?? result.disposition}</Badge>
                    <span className="text-sm font-bold text-text">Score {result.score}</span>
                  </div>
                  {result.triviaStatus === "UNCERTAIN" && result.evidence.length === 0 && (
                    <p className="mt-0.5 text-xs text-text-muted">Not yet researched</p>
                  )}
                  {result.rejectionReasonName && <p className="mt-0.5 text-xs text-text-muted">Reason: {result.rejectionReasonName}</p>}

                  {researchErrors[result.id] && (
                    <p className="mt-2 text-xs font-semibold text-danger">{researchErrors[result.id]}</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <ResultActions
                      result={result}
                      canResearch={canResearch}
                      canRestore={canRestore}
                      rejectionReasons={rejectionReasons}
                      isPending={isPending}
                      onResearch={() =>
                        startTransition(async () => {
                          setResearchError(result.id, null);
                          const outcome = await researchResult(result.id);
                          if (outcome?.error) setResearchError(result.id, outcome.error);
                        })
                      }
                      onRestore={() =>
                        startTransition(() => {
                          void restoreResult(result.id);
                        })
                      }
                      onReject={(reasonId) =>
                        startTransition(() => {
                          void rejectResult(result.id, reasonId);
                        })
                      }
                    />
                  </div>

                  {expanded === result.id && canViewEvidence && (
                    <div className="mt-3 rounded-lg bg-black/[0.02] p-3">
                      <ResultEvidencePanel result={result} minimumScore={minimumScore} />
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
          {results.length === 0 && <li className="px-5 py-8 text-center text-text-muted">No results in this view.</li>}
        </ul>
      </Card>

      <Pagination page={page} pageCount={totalPages} onNavigate={(targetPage) => goto({ page: String(targetPage) })} />
    </div>
  );
}
