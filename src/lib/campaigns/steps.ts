// Campaign step-ordering helpers — the same role sequences.ts's
// nextActionableStep/firstActionableStep play for FollowUpSequence, but
// simpler: there is no WAIT-only step type here (every CampaignStep sends
// an email), so no folding of skipped steps is needed.

export type CampaignStepLike = { id: string; stepOrder: number; waitDays: number };

export function firstStep<T extends CampaignStepLike>(steps: T[]): T | null {
  if (steps.length === 0) return null;
  return [...steps].sort((a, b) => a.stepOrder - b.stepOrder)[0];
}

export function stepAfter<T extends CampaignStepLike>(steps: T[], afterOrder: number): T | null {
  const next = steps.filter((s) => s.stepOrder > afterOrder).sort((a, b) => a.stepOrder - b.stepOrder);
  return next[0] ?? null;
}

export function isLastStep<T extends CampaignStepLike>(steps: T[], stepOrder: number): boolean {
  return stepAfter(steps, stepOrder) === null;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** The instant a step becomes due, relative to the previous step's actual
 * send time (or "now" for the first step, at campaign-start time). */
export function dueAtFor(step: CampaignStepLike, from: Date): Date {
  return addDays(from, step.waitDays);
}
