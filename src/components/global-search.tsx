"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { globalSearchAction } from "@/app/(dashboard)/search/actions";
import type { GlobalSearchResult, GlobalSearchResults } from "@/lib/search/global-search-types";
import { MIN_QUERY_LENGTH } from "@/lib/search/global-search-types";
import { useFocusTrap } from "@/hooks/use-focus-trap";

const DEBOUNCE_MS = 300;
const EMPTY_RESULTS: GlobalSearchResults = { companies: [], contacts: [], competitors: [] };

type FlatResult = GlobalSearchResult & { groupLabel: string };

function flatten(results: GlobalSearchResults): FlatResult[] {
  return [
    ...results.companies.map((r) => ({ ...r, groupLabel: "Companies" })),
    ...results.contacts.map((r) => ({ ...r, groupLabel: "Contacts" })),
    ...results.competitors.map((r) => ({ ...r, groupLabel: "Competitors" })),
  ];
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useFocusTrap(dialogRef, open);

  const flat = flatten(results);

  // Debounced search — a fresh timer per keystroke, cleared on unmount/
  // re-run. setLoading(true) happens in the input's onChange handler below
  // (a real event handler), not synchronously in this effect's body — every
  // setState call in here happens inside the setTimeout callback, past a
  // genuine async boundary, which is what this codebase's stricter
  // react-hooks/set-state-in-effect lint rule requires. Below
  // MIN_QUERY_LENGTH, this simply never fires — stale results from a
  // previous longer query are never cleared here; the render below instead
  // gates on the current query length directly, so stale results just never
  // get shown regardless of what's still sitting in state.
  useEffect(() => {
    if (!open || query.trim().length < MIN_QUERY_LENGTH) return;
    const timer = setTimeout(async () => {
      const outcome = await globalSearchAction(query);
      if (outcome.ok) {
        setResults(outcome.results);
        setError(null);
      } else {
        setError(outcome.error);
      }
      setLoading(false);
      setActiveIndex(-1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults(EMPTY_RESULTS);
    setError(null);
    setActiveIndex(-1);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function selectResult(result: FlatResult) {
    close();
    router.push(result.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = activeIndex >= 0 ? flat[activeIndex] : flat[0];
      if (target) selectResult(target);
    }
  }

  function renderGroup(label: string, items: GlobalSearchResult[]) {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-text-muted">{label}</p>
        <ul>
          {items.map((item) => {
            const index = flat.findIndex((f) => f.type === item.type && f.id === item.id);
            const isActive = index === activeIndex;
            return (
              <li key={`${item.type}-${item.id}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectResult(item as FlatResult)}
                  className={`block w-full px-3 py-2 text-left text-sm ${isActive ? "bg-secondary/10 text-secondary" : "text-text hover:bg-black/5"}`}
                >
                  <span className="font-semibold">{item.title}</span>
                  <span className="ml-2 text-text-muted">{item.subtitle}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search companies, contacts, and competitors"
        className="rounded-lg border border-border-strong p-2 text-text hover:bg-black/5"
      >
        <Search size={18} />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-near-black/40 p-4 pt-24" onClick={close} aria-hidden="true">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-surface-raised shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search size={16} className="text-text-muted" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuery(value);
                  if (value.trim().length >= MIN_QUERY_LENGTH) setLoading(true);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Search companies, contacts, competitors…"
                aria-label="Search query"
                aria-activedescendant={activeIndex >= 0 ? `global-search-result-${activeIndex}` : undefined}
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls="global-search-results"
                autoComplete="off"
                className="flex-1 bg-transparent py-2 text-sm text-text outline-none"
              />
              <button type="button" onClick={close} aria-label="Close search" className="rounded p-1 text-text-muted hover:bg-black/5">
                <X size={16} />
              </button>
            </div>

            <div id="global-search-results" className="max-h-96 overflow-y-auto py-1">
              {query.trim().length < MIN_QUERY_LENGTH ? (
                <p className="px-3 py-6 text-center text-sm text-text-muted">Type at least {MIN_QUERY_LENGTH} characters to search.</p>
              ) : error ? (
                <p className="px-3 py-6 text-center text-sm text-danger">{error}</p>
              ) : loading ? (
                <p className="px-3 py-6 text-center text-sm text-text-muted">Searching…</p>
              ) : flat.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-text-muted">No matches for &quot;{query}&quot;.</p>
              ) : (
                <>
                  {renderGroup("Companies", results.companies)}
                  {renderGroup("Contacts", results.contacts)}
                  {renderGroup("Competitors", results.competitors)}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
