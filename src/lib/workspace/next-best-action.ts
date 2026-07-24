// Deterministic, table-driven "what should I do next on this company?"
// suggestions for the company detail page. Pure — no DB access — so it's
// unit-tested directly, same convention as computeDailyPriorityList in
// ./priority.ts. Display/suggestion only: never auto-contacts the company
// or auto-changes its stage, and every item states its reason in plain
// text rather than an opaque score.

export type NextBestActionCode =
  | "OVERDUE_FOLLOW_UP"
  | "PENDING_DUPLICATE"
  | "NO_CONTACT"
  | "TRIAL_NEEDS_REVIEW"
  | "NO_FOLLOW_UP_SCHEDULED"
  | "NO_RECENT_ACTIVITY";

export type NextBestActionItem = {
  code: NextBestActionCode;
  label: string;
  reason: string;
};

export type NextBestActionInput = {
  now: Date;
  noActivityThresholdDays: number;
  contactCount: number;
  /** The company's current pipeline stage outcomeType — null means the
   * pipeline is still open (not yet won or lost). */
  pipelineOutcomeType: string | null;
  /** Most recent activity's occurredAt, or the company's createdAt if it
   * has never had one — same "reference point" convention priority-data.ts
   * uses for its stale-company check. */
  referenceActivityAt: Date;
  /** occurredAt of the most recent TRIAL-type activity, if any. */
  lastTrialActivityAt: Date | null;
  openTasks: { dueAt: Date }[];
  hasPendingDuplicate: boolean;
};

export function computeNextBestActions(input: NextBestActionInput): NextBestActionItem[] {
  const items: NextBestActionItem[] = [];

  const hasOverdueTask = input.openTasks.some((t) => t.dueAt.getTime() < input.now.getTime());
  if (hasOverdueTask) {
    items.push({
      code: "OVERDUE_FOLLOW_UP",
      label: "Complete the overdue follow-up",
      reason: "A scheduled follow-up on this company is past its due date.",
    });
  }

  if (input.hasPendingDuplicate) {
    items.push({
      code: "PENDING_DUPLICATE",
      label: "Resolve the duplicate warning",
      reason: "This company has an unresolved potential-duplicate match awaiting review.",
    });
  }

  if (input.contactCount === 0) {
    items.push({
      code: "NO_CONTACT",
      label: "Add a contact",
      reason: "This company has no contact on file.",
    });
  }

  const isOpenPipeline = input.pipelineOutcomeType === null;
  const hasOpenTask = input.openTasks.length > 0;

  if (isOpenPipeline && !hasOpenTask && input.lastTrialActivityAt) {
    items.push({
      code: "TRIAL_NEEDS_REVIEW",
      label: "Review the trial",
      reason: "A trial was logged and there is no follow-up scheduled to review it.",
    });
  } else if (isOpenPipeline && !hasOpenTask) {
    items.push({
      code: "NO_FOLLOW_UP_SCHEDULED",
      label: "Schedule a follow-up",
      reason: "There is no open follow-up scheduled for this company.",
    });
  }

  const noActivityThreshold = new Date(input.now.getTime() - input.noActivityThresholdDays * 24 * 60 * 60 * 1000);
  if (input.referenceActivityAt.getTime() < noActivityThreshold.getTime()) {
    items.push({
      code: "NO_RECENT_ACTIVITY",
      label: "Log an activity",
      reason: `No activity has been recorded in over ${input.noActivityThresholdDays} days.`,
    });
  }

  return items;
}
