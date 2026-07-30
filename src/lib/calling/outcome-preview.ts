// Pure "what will happen" description — the spec requires the salesperson
// see this BEFORE saving a call outcome, so it has to be derivable from the
// outcome's own config with no server round-trip (the guided call screen
// already has every active CallOutcome loaded for the picker).

export type CallOutcomeLike = {
  name: string;
  requiresNotes: boolean;
  requiresNextAction: boolean;
  defaultNextActionDays: number | null;
  defaultNextActionTitle: string | null;
  defaultPipelineStageName?: string | null;
  opensEmailComposer: boolean;
  requiresRejectionReason: boolean;
  skipRestOfSession: boolean;
  appliesDoNotContact: boolean;
};

export function describeDefaultAction(outcome: CallOutcomeLike): string[] {
  const lines: string[] = [];
  if (outcome.requiresNextAction && outcome.defaultNextActionDays !== null) {
    lines.push(`Create a follow-up "${outcome.defaultNextActionTitle ?? outcome.name}" due in ${outcome.defaultNextActionDays} day(s).`);
  }
  if (outcome.defaultPipelineStageName) {
    lines.push(`Move the company to the "${outcome.defaultPipelineStageName}" pipeline stage.`);
  }
  if (outcome.appliesDoNotContact) {
    lines.push("Mark the company as do-not-contact.");
  }
  if (outcome.opensEmailComposer) {
    lines.push("Open the email composer for you to review and send (never sent automatically).");
  }
  if (outcome.requiresRejectionReason) {
    lines.push("You'll be asked to choose a reason.");
  }
  if (outcome.requiresNotes) {
    lines.push("Notes are required.");
  }
  if (outcome.skipRestOfSession) {
    lines.push("This company won't be offered again for the rest of this session.");
  }
  return lines;
}
