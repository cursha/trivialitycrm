"use client";

import { useState, useTransition } from "react";
import { setLeadTypeRoutePlanSettings } from "./actions";
import { sanitizeRoutePlanSlug } from "@/lib/route-plan/validation";

/**
 * Per-lead-type Route Plan eligibility + filename slug — rendered as one
 * cell of LookupTable's generic extraColumn (see lookup-table.tsx). Its own
 * small form/save rather than an instant-toggle like Pipeline Stages'
 * outcome select, since enabling requires a second value (the slug) at the
 * same time — an enabled-with-no-slug state would leave exports broken
 * with no explanation until someone actually tried to export.
 */
export function LeadTypeRouteSettings({ leadTypeId, initialEnabled, initialSlug }: { leadTypeId: string; initialEnabled: boolean; initialSlug: string | null }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    setSaved(false);
    const formData = new FormData();
    if (enabled) formData.set("routePlanEnabled", "on");
    formData.set("routePlanSlug", slug);
    startTransition(async () => {
      const result = await setLeadTypeRoutePlanSettings(leadTypeId, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-xs font-semibold text-text">
        <input
          type="checkbox"
          checked={enabled}
          disabled={isPending}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
        />
        Available for Route Planning
      </label>
      {enabled && (
        <input
          type="text"
          value={slug}
          disabled={isPending}
          placeholder="filename-slug"
          onChange={(e) => {
            setSlug(sanitizeRoutePlanSlug(e.target.value));
            setSaved(false);
          }}
          className="w-36 rounded border border-border-strong px-2 py-1 text-xs"
          aria-label="Route Plan filename slug"
        />
      )}
      <button
        type="button"
        disabled={isPending}
        onClick={handleSave}
        className="w-fit text-xs font-semibold text-secondary hover:underline disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
      {saved && !error && <p className="text-xs font-semibold text-emerald-700">Saved.</p>}
      {error && <p className="text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}
