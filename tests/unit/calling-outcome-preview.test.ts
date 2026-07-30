import { describe, it, expect } from "vitest";
import { describeDefaultAction, type CallOutcomeLike } from "../../src/lib/calling/outcome-preview";

function outcome(overrides: Partial<CallOutcomeLike> = {}): CallOutcomeLike {
  return {
    name: "No Answer",
    requiresNotes: false,
    requiresNextAction: false,
    defaultNextActionDays: null,
    defaultNextActionTitle: null,
    defaultPipelineStageName: null,
    opensEmailComposer: false,
    requiresRejectionReason: false,
    skipRestOfSession: false,
    appliesDoNotContact: false,
    ...overrides,
  };
}

describe("describeDefaultAction", () => {
  it("describes an empty config with no lines", () => {
    expect(describeDefaultAction(outcome())).toEqual([]);
  });

  it("describes a default follow-up", () => {
    const lines = describeDefaultAction(outcome({ requiresNextAction: true, defaultNextActionDays: 2, defaultNextActionTitle: "Follow up call" }));
    expect(lines).toContain('Create a follow-up "Follow up call" due in 2 day(s).');
  });

  it("falls back to the outcome name when no follow-up title is configured", () => {
    const lines = describeDefaultAction(outcome({ name: "Left Message", requiresNextAction: true, defaultNextActionDays: 3, defaultNextActionTitle: null }));
    expect(lines).toContain('Create a follow-up "Left Message" due in 3 day(s).');
  });

  it("describes a pipeline stage change", () => {
    expect(describeDefaultAction(outcome({ defaultPipelineStageName: "Lost" }))).toContain('Move the company to the "Lost" pipeline stage.');
  });

  it("describes the do-not-contact restriction", () => {
    expect(describeDefaultAction(outcome({ appliesDoNotContact: true }))).toContain("Mark the company as do-not-contact.");
  });

  it("describes opening the email composer without implying an automatic send", () => {
    const lines = describeDefaultAction(outcome({ opensEmailComposer: true }));
    expect(lines.some((l) => l.includes("never sent automatically"))).toBe(true);
  });

  it("describes every configured behavior together", () => {
    const lines = describeDefaultAction(
      outcome({
        requiresNotes: true,
        requiresNextAction: true,
        defaultNextActionDays: 1,
        requiresRejectionReason: true,
        skipRestOfSession: true,
      }),
    );
    expect(lines).toHaveLength(4);
  });
});
