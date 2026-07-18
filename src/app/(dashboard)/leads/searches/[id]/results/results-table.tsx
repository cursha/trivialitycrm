"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { rejectResult, restoreResult } from "./actions";

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
};

export function ResultsTable({
  results,
  rejectionReasons,
  canRestore,
  canViewEvidence,
  canTransfer,
  canExport,
  view,
  sort,
  page,
  pageSize,
  total,
  searchId,
}: {
  results: ResultRow[];
  rejectionReasons: { id: string; name: string }[];
  canRestore: boolean;
  canViewEvidence: boolean;
  canTransfer: boolean;
  canExport: boolean;
  view: string;
  sort: string;
  page: number;
  pageSize: number;
  total: number;
  searchId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === "default" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            Meets minimum score
          </button>
          <button
            type="button"
            onClick={() => goto({ view: "all", page: "1" })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === "all" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            All results
          </button>
          <button
            type="button"
            onClick={() => goto({ sort: sort === "score_desc" ? "score_asc" : "score_desc" })}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600"
          >
            Score: {sort === "score_desc" ? "High to low" : "Low to high"}
          </button>
        </div>

        <div className="flex gap-2">
          {canExport && (
            <>
              <a
                href={`/api/export/search-results?searchId=${searchId}&view=${view}&format=csv`}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
              >
                Export CSV
              </a>
              <a
                href={`/api/export/search-results?searchId=${searchId}&view=${view}&format=xlsx`}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
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
                selected.size > 0 ? "bg-blue-600" : "pointer-events-none bg-slate-300"
              }`}
            >
              Transfer selected ({selected.size})
            </Link>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
                <tr className="border-t border-slate-100">
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
                      className="flex items-center gap-1 font-semibold hover:text-blue-600"
                    >
                      {expanded === result.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {result.name}
                    </button>
                    {result.competitorName && <p className="mt-0.5 text-xs text-amber-600">Uses {result.competitorName}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {result.city}, {result.region}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        result.triviaStatus === "CURRENT_TRIVIA"
                          ? "bg-amber-50 text-amber-700"
                          : result.triviaStatus === "NO_CURRENT_TRIVIA"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {result.triviaStatus.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold">{result.score}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {result.disposition}
                    {result.rejectionReasonName && ` — ${result.rejectionReasonName}`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {result.disposition === "REJECTED" && canRestore && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          startTransition(() => {
                            void restoreResult(result.id);
                          })
                        }
                        className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700"
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
                          if (!reasonId) return;
                          startTransition(() => {
                            void rejectResult(result.id, reasonId);
                          });
                        }}
                        className="rounded border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="">Reject...</option>
                        {rejectionReasons.map((reason) => (
                          <option key={reason.id} value={reason.id}>
                            {reason.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
                {expanded === result.id && canViewEvidence && (
                  <tr className="border-t border-slate-100 bg-slate-50">
                    <td colSpan={7} className="px-4 py-4">
                      <p className="text-sm font-semibold text-slate-700">Score explanation</p>
                      <p className="mb-3 text-sm text-slate-600">{result.explanation}</p>
                      <p className="text-sm font-semibold text-slate-700">Evidence</p>
                      {result.evidence.length === 0 ? (
                        <p className="text-sm text-slate-400">No evidence recorded.</p>
                      ) : (
                        <ul className="mb-3 space-y-1 text-sm text-slate-600">
                          {result.evidence.map((entry, index) => (
                            <li key={index}>
                              <span className="font-semibold">[{entry.verificationStatus}]</span> {entry.note}
                              {entry.sourceUrl && (
                                <a href={entry.sourceUrl} target="_blank" rel="noreferrer noopener" className="ml-1 text-blue-600 hover:underline">
                                  source
                                </a>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="text-sm font-semibold text-slate-700">Sources</p>
                      {result.sources.length === 0 ? (
                        <p className="text-sm text-slate-400">No sources recorded.</p>
                      ) : (
                        <ul className="space-y-1 text-sm text-blue-600">
                          {result.sources.map((source, index) => (
                            <li key={index}>
                              <a href={source.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                                {source.title ?? source.url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                  No results in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => goto({ page: String(page - 1) })}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => goto({ page: String(page + 1) })}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
