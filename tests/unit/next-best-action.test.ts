import { describe, it, expect } from "vitest";
import { computeNextBestActions, type NextBestActionInput } from "../../src/lib/workspace/next-best-action";

const NOW = new Date("2026-01-15T12:00:00Z");

function baseInput(overrides: Partial<NextBestActionInput> = {}): NextBestActionInput {
  return {
    now: NOW,
    noActivityThresholdDays: 14,
    contactCount: 1,
    pipelineOutcomeType: null,
    referenceActivityAt: NOW,
    lastTrialActivityAt: null,
    openTasks: [{ dueAt: new Date("2026-01-20T12:00:00Z") }],
    hasPendingDuplicate: false,
    ...overrides,
  };
}

describe("computeNextBestActions", () => {
  it("returns nothing when everything is in good shape", () => {
    expect(computeNextBestActions(baseInput())).toEqual([]);
  });

  it("flags an overdue open follow-up", () => {
    const result = computeNextBestActions(baseInput({ openTasks: [{ dueAt: new Date("2026-01-01T12:00:00Z") }] }));
    expect(result.map((i) => i.code)).toContain("OVERDUE_FOLLOW_UP");
  });

  it("does not flag a follow-up that is due in the future", () => {
    const result = computeNextBestActions(baseInput({ openTasks: [{ dueAt: new Date("2026-01-20T12:00:00Z") }] }));
    expect(result.map((i) => i.code)).not.toContain("OVERDUE_FOLLOW_UP");
  });

  it("flags a pending duplicate warning", () => {
    const result = computeNextBestActions(baseInput({ hasPendingDuplicate: true }));
    expect(result.map((i) => i.code)).toContain("PENDING_DUPLICATE");
  });

  it("flags a company with no contact on file", () => {
    const result = computeNextBestActions(baseInput({ contactCount: 0 }));
    expect(result.map((i) => i.code)).toContain("NO_CONTACT");
  });

  it("flags an open pipeline with a trial logged and no follow-up scheduled", () => {
    const result = computeNextBestActions(
      baseInput({ openTasks: [], lastTrialActivityAt: new Date("2026-01-10T12:00:00Z") }),
    );
    expect(result.map((i) => i.code)).toContain("TRIAL_NEEDS_REVIEW");
    expect(result.map((i) => i.code)).not.toContain("NO_FOLLOW_UP_SCHEDULED");
  });

  it("flags a missing follow-up for an open pipeline with no trial and no open task", () => {
    const result = computeNextBestActions(baseInput({ openTasks: [] }));
    expect(result.map((i) => i.code)).toContain("NO_FOLLOW_UP_SCHEDULED");
    expect(result.map((i) => i.code)).not.toContain("TRIAL_NEEDS_REVIEW");
  });

  it("does not suggest scheduling a follow-up once the pipeline is won or lost", () => {
    const result = computeNextBestActions(baseInput({ openTasks: [], pipelineOutcomeType: "WON" }));
    expect(result.map((i) => i.code)).not.toContain("NO_FOLLOW_UP_SCHEDULED");
    expect(result.map((i) => i.code)).not.toContain("TRIAL_NEEDS_REVIEW");
  });

  it("flags no recent activity beyond the configured threshold", () => {
    const result = computeNextBestActions(
      baseInput({ referenceActivityAt: new Date("2025-12-01T12:00:00Z"), noActivityThresholdDays: 14 }),
    );
    expect(result.map((i) => i.code)).toContain("NO_RECENT_ACTIVITY");
  });

  it("does not flag recent activity within the threshold", () => {
    const result = computeNextBestActions(
      baseInput({ referenceActivityAt: new Date("2026-01-10T12:00:00Z"), noActivityThresholdDays: 14 }),
    );
    expect(result.map((i) => i.code)).not.toContain("NO_RECENT_ACTIVITY");
  });

  it("orders items: overdue follow-up, pending duplicate, no contact, trial/follow-up, stale activity", () => {
    const result = computeNextBestActions(
      baseInput({
        openTasks: [{ dueAt: new Date("2026-01-01T12:00:00Z") }],
        hasPendingDuplicate: true,
        contactCount: 0,
        referenceActivityAt: new Date("2025-12-01T12:00:00Z"),
      }),
    );
    expect(result.map((i) => i.code)).toEqual(["OVERDUE_FOLLOW_UP", "PENDING_DUPLICATE", "NO_CONTACT", "NO_RECENT_ACTIVITY"]);
  });

  it("every item states a plain-text reason", () => {
    const result = computeNextBestActions(baseInput({ contactCount: 0, hasPendingDuplicate: true }));
    for (const item of result) {
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });
});
