// No "server-only": the company form and Sales process card (client
// components) use these labels and helpers too.
import type { SalesStep, SalesTrack } from "../../generated/prisma/enums";

export const SALES_TRACK_LABELS: Record<SalesTrack, string> = {
  LOCAL: "Local",
  REMOTE: "Long-distance",
};

/** Steps a long-distance bar may skip straight past to Trial Booked: they
 * can go right to a trial without a demo. */
export const REMOTE_SKIP_TO_TRIAL_FROM: readonly SalesStep[] = ["TARGET", "INTRODUCED", "DEMO_BOOKED", "DEMO_HELD"];

/** A stage's playbook text as checklist lines (one per line, blanks dropped). */
export function playbookLines(text: string | null): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** A rep's trial length when none is set, and the most a trial can run. */
export const DEFAULT_TRIAL_WEEKS = 4;
export const MAX_TRIAL_WEEKS = 4;

export function trialWeeksFor(rep: { trialLengthWeeks: number | null } | null | undefined): number {
  return rep?.trialLengthWeeks ?? DEFAULT_TRIAL_WEEKS;
}

/** Fills the {{trialWeeks}} placeholder in step text (checklists,
 * descriptions, follow-up titles) with the bar's rep's trial length,
 * keeping "week"/"weeks" grammatical. */
export function fillTrialWeeks(text: string, weeks: number): string {
  return text.replaceAll("{{trialWeeks}} weeks", weeks === 1 ? "1 week" : `${weeks} weeks`).replaceAll("{{trialWeeks}}", String(weeks));
}
