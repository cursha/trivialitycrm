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
