"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateBarIntel } from "./actions";
import { Card } from "@/components/ui/card";
import { Input, Label, Select, Textarea, FieldError } from "@/components/ui/field";
import { WEEKDAY_LABEL } from "@/lib/ui/status-tones";

export type BarIntel = {
  slowNight: string | null;
  slowNightHeadcount: number | null;
  currentEntertainment: string | null;
  triviaHistory: string | null;
};

export const WEEKDAY_OPTIONS = Object.entries(WEEKDAY_LABEL);

/** What the rep learned at the door — the facts the pitch ("which night is
 * quietest for you?") and, later, the trial baseline are built on. Also
 * fillable straight from the visit form; this card is the full editor. */
export function BarIntelPanel({ companyId, intel, canEdit }: { companyId: string; intel: BarIntel; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave(formData: FormData) {
    startTransition(async () => {
      const result = await updateBarIntel(companyId, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-accent">Bar intel</h2>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline">
            <Pencil size={14} />
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <form action={handleSave} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="bar-intel-slow-night" className="text-xs">
              Slowest night
            </Label>
            <Select id="bar-intel-slow-night" name="slowNight" defaultValue={intel.slowNight ?? ""} className="mt-1 py-1.5">
              <option value="">Unknown</option>
              {WEEKDAY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="bar-intel-headcount" className="text-xs">
              Typical crowd that night
            </Label>
            <Input
              id="bar-intel-headcount"
              name="slowNightHeadcount"
              type="number"
              inputMode="numeric"
              min={0}
              max={5000}
              defaultValue={intel.slowNightHeadcount ?? ""}
              placeholder="e.g. 15"
              className="mt-1 py-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="bar-intel-entertainment" className="text-xs">
              Current entertainment
            </Label>
            <Input
              id="bar-intel-entertainment"
              name="currentEntertainment"
              maxLength={200}
              defaultValue={intel.currentEntertainment ?? ""}
              placeholder="e.g. Karaoke Thursdays, nothing midweek"
              className="mt-1 py-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="bar-intel-trivia-history" className="text-xs">
              Trivia history
            </Label>
            <Textarea
              id="bar-intel-trivia-history"
              name="triviaHistory"
              rows={3}
              maxLength={2000}
              defaultValue={intel.triviaHistory ?? ""}
              placeholder="e.g. Ran trivia with another company on Tuesdays until last spring; stopped because turnout dropped"
              className="mt-1 py-1.5"
            />
          </div>
          {error && <FieldError className="sm:col-span-2">{error}</FieldError>}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Slowest night</dt>
            <dd className="mt-0.5 text-sm text-text">{intel.slowNight ? WEEKDAY_LABEL[intel.slowNight] : <span className="text-text-muted">—</span>}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Typical crowd</dt>
            <dd className="mt-0.5 text-sm text-text">
              {intel.slowNightHeadcount !== null ? `${intel.slowNightHeadcount} people` : <span className="text-text-muted">—</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Current entertainment</dt>
            <dd className="mt-0.5 text-sm text-text">{intel.currentEntertainment || <span className="text-text-muted">—</span>}</dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">Trivia history</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm text-text">{intel.triviaHistory || <span className="text-text-muted">—</span>}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
