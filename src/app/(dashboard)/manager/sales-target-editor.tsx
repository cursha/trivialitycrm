"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSalesTarget } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, FieldError } from "@/components/ui/field";
import { SCOREBOARD_LABELS, SCOREBOARD_METRICS, type ScoreCounts } from "@/lib/sales/scoreboard-metrics";
import { MAX_TRIAL_WEEKS } from "@/lib/companies/sales-track";

/** The timezones the team works in; anything else already saved is kept
 * as an extra option. */
const TIMEZONES = [
  ["America/Toronto", "Eastern (Toronto)"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain (Colorado Springs)"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
] as const;

export type RepGoals = { userId: string; name: string; timezone: string | null; trialWeeks: number; targets: ScoreCounts };

/** Per-rep daily goals and timezone, edited one rep at a time. */
export function SalesTargetEditor({ reps }: { reps: RepGoals[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(userId: string, formData: FormData) {
    startTransition(async () => {
      const result = await saveSalesTarget(userId, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setEditingId(null);
        router.refresh();
      }
    });
  }

  return (
    <ul className="mt-3 divide-y divide-border">
      {reps.map((rep) => {
        const editing = editingId === rep.userId;
        const timezoneOptions =
          rep.timezone && !TIMEZONES.some(([value]) => value === rep.timezone) ? [...TIMEZONES, [rep.timezone, rep.timezone] as const] : TIMEZONES;
        return (
          <li key={rep.userId} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-text">{rep.name}</p>
                <p className="text-xs text-text-muted">
                  {SCOREBOARD_METRICS.filter((metric) => rep.targets[metric] > 0)
                    .map((metric) => `${SCOREBOARD_LABELS[metric]} ${rep.targets[metric]}`)
                    .join(" · ") || "No goals"}
                  {" · "}
                  Trials up to {rep.trialWeeks} week{rep.trialWeeks === 1 ? "" : "s"}
                  {" · "}
                  {rep.timezone ?? "America/Toronto (default)"}
                </p>
              </div>
              {!editing && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setEditingId(rep.userId);
                  }}
                  className="text-sm font-bold text-secondary hover:underline"
                >
                  Edit
                </button>
              )}
            </div>

            {editing && (
              <form action={(formData) => save(rep.userId, formData)} className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
                  {SCOREBOARD_METRICS.map((metric) => (
                    <div key={metric}>
                      <Label htmlFor={`${rep.userId}-${metric}`} className="text-xs">
                        {SCOREBOARD_LABELS[metric]}
                      </Label>
                      <Input
                        id={`${rep.userId}-${metric}`}
                        name={metric}
                        type="number"
                        min={0}
                        max={500}
                        required
                        defaultValue={rep.targets[metric]}
                        className="mt-1 py-1.5"
                      />
                    </div>
                  ))}
                  <div>
                    <Label htmlFor={`${rep.userId}-trial`} className="text-xs">
                      Trial length (weeks)
                    </Label>
                    <Select id={`${rep.userId}-trial`} name="trialLengthWeeks" defaultValue={String(rep.trialWeeks)} className="mt-1 py-1.5">
                      {Array.from({ length: MAX_TRIAL_WEEKS }, (_, index) => index + 1).map((weeks) => (
                        <option key={weeks} value={weeks}>
                          {weeks} week{weeks === 1 ? "" : "s"}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`${rep.userId}-timezone`} className="text-xs">
                      Timezone
                    </Label>
                    <Select id={`${rep.userId}-timezone`} name="timezone" defaultValue={rep.timezone ?? ""} className="mt-1 py-1.5">
                      <option value="">Default (Toronto)</option>
                      {timezoneOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-text-muted">
                  Goals are per day; 0 hides a number from the rep&apos;s scoreboard unless they do some. Trial length applies to this rep&apos;s bars from the next time one enters a step.
                </p>
                {error && <FieldError>{error}</FieldError>}
                <div className="flex gap-2">
                  <Button type="submit" disabled={isPending}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" disabled={isPending} onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
