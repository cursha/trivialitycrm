"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import clsx from "clsx";
import { changeCompanyStage } from "../../actions";
import { setSalesTrack } from "./actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SALES_TRACK_LABELS, REMOTE_SKIP_TO_TRIAL_FROM, playbookLines } from "@/lib/companies/sales-track";
import type { SalesStep, SalesTrack } from "@/generated/prisma/enums";

export type ProcessStepView = {
  id: string;
  name: string;
  processStep: SalesStep;
  playbookLocal: string | null;
  playbookRemote: string | null;
  followUps: { title: string; daysAfter: number; track: SalesTrack | null }[];
};

function describeDue(daysAfter: number): string {
  if (daysAfter === 0) return "same day";
  if (daysAfter === 1) return "next day";
  return `in ${daysAfter} days`;
}

/**
 * The sales process for one bar: where it is, what to do at this step for
 * its track (Local or Long-distance), and a one-click move to the next
 * step. Moving goes through the same changeCompanyStage action as the
 * pipeline board, so the stage history and the new step's automatic
 * follow-ups are identical whichever way it's moved.
 */
export function SalesProcessPanel({
  companyId,
  track,
  currentStage,
  steps,
  wonStage,
  canEdit,
}: {
  companyId: string;
  track: SalesTrack;
  currentStage: { id: string; name: string; outcomeType: "WON" | "LOST" | null };
  steps: ProcessStepView[];
  wonStage: { id: string; name: string } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const currentIndex = steps.findIndex((step) => step.id === currentStage.id);
  const current = currentIndex >= 0 ? steps[currentIndex] : null;
  const isWon = currentStage.outcomeType === "WON";
  const isLost = currentStage.outcomeType === "LOST";

  const nextStep = current ? (steps[currentIndex + 1] ?? null) : null;
  const next: { id: string; name: string } | null = current ? (nextStep ?? wonStage) : null;
  const trialBooked = steps.find((step) => step.processStep === "TRIAL_BOOKED") ?? null;
  const canSkipToTrial =
    track === "REMOTE" && current !== null && trialBooked !== null && trialBooked.id !== next?.id && REMOTE_SKIP_TO_TRIAL_FROM.includes(current.processStep);

  const checklist = current ? playbookLines(track === "REMOTE" ? current.playbookRemote : current.playbookLocal) : [];
  const followUpsFor = (step: ProcessStepView | undefined) => (step?.followUps ?? []).filter((task) => task.track === null || task.track === track);

  function run(action: () => Promise<{ error?: string } | { success: true } | undefined>) {
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) {
        setError(result.error);
      } else {
        setError(null);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold text-accent">Sales process</h2>
        <div className="flex rounded-lg border border-border-strong p-0.5 text-sm" role="group" aria-label="Sales process track">
          {(Object.keys(SALES_TRACK_LABELS) as SalesTrack[]).map((value) => (
            <button
              key={value}
              type="button"
              disabled={!canEdit || isPending}
              aria-pressed={track === value}
              onClick={() => track !== value && run(() => setSalesTrack(companyId, value))}
              className={clsx(
                "rounded-md px-3 py-1 font-semibold transition-colors disabled:cursor-default",
                track === value ? "bg-accent text-white" : "text-text-muted hover:bg-black/5",
              )}
            >
              {SALES_TRACK_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <ol className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
        {steps.map((step, index) => {
          const done = isWon || (currentIndex >= 0 && index < currentIndex);
          const active = step.id === currentStage.id;
          return (
            <li
              key={step.id}
              aria-current={active ? "step" : undefined}
              className={clsx(
                "flex items-center gap-1 rounded-full border px-3 py-1",
                active && "border-accent bg-accent text-white",
                done && !active && "border-accent/40 bg-accent/10 text-accent",
                !active && !done && "border-border text-text-muted",
              )}
            >
              {done && !active && <Check size={12} aria-hidden="true" />}
              {index + 1}. {step.name}
            </li>
          );
        })}
      </ol>

      {current ? (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              What to do now ({SALES_TRACK_LABELS[track]})
            </p>
            {checklist.length > 0 ? (
              <ul className="mt-2 space-y-1.5 text-sm text-text">
                {checklist.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-text-muted">No checklist set for this step yet (Settings → Pipeline Stages).</p>
            )}
          </div>

          {canEdit && (next || canSkipToTrial) && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {next && (
                  <Button type="button" disabled={isPending} onClick={() => run(() => changeCompanyStage(companyId, next.id))}>
                    Move to {next.name}
                  </Button>
                )}
                {canSkipToTrial && trialBooked && (
                  <Button type="button" variant="secondary" disabled={isPending} onClick={() => run(() => changeCompanyStage(companyId, trialBooked.id))}>
                    Skip the demo: {trialBooked.name}
                  </Button>
                )}
              </div>
              {nextStep && followUpsFor(nextStep).length > 0 && (
                <p className="text-xs text-text-muted">
                  Moving to {nextStep.name} adds follow-ups:{" "}
                  {followUpsFor(nextStep)
                    .map((task) => `${task.title} (${describeDue(task.daysAfter)})`)
                    .join("; ")}
                  .
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-muted">
          {isWon
            ? "Won: this bar is a customer."
            : isLost
              ? "Lost. Move it back to a step from the edit form if it re-engages."
              : `This bar is in "${currentStage.name}", which isn't one of the sales process steps. Move it to a step from the edit form or the pipeline board.`}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
