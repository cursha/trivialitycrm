import { describe, it, expect } from "vitest";
import { nextActionableStep, firstActionableStep, previewSteps, type StepLike } from "../../src/lib/comms/sequences";

function step(overrides: Partial<StepLike>): StepLike {
  return { id: overrides.id ?? `step-${overrides.stepOrder}`, stepOrder: 0, type: "WAIT", waitDays: null, ...overrides };
}

describe("firstActionableStep / nextActionableStep", () => {
  it("returns the very first step with zero wait when it's already actionable", () => {
    const steps = [step({ stepOrder: 1, type: "EMAIL" }), step({ stepOrder: 2, type: "WAIT", waitDays: 3 })];
    expect(firstActionableStep(steps)).toEqual({ step: steps[0], waitDays: 0 });
  });

  it("folds a leading WAIT step's days into the first actionable step's due offset", () => {
    const steps = [step({ stepOrder: 1, type: "WAIT", waitDays: 5 }), step({ stepOrder: 2, type: "EMAIL" })];
    const result = firstActionableStep(steps);
    expect(result?.step.stepOrder).toBe(2);
    expect(result?.waitDays).toBe(5);
  });

  it("sums multiple consecutive WAIT steps between two actionable steps", () => {
    const steps = [
      step({ stepOrder: 1, type: "EMAIL" }),
      step({ stepOrder: 2, type: "WAIT", waitDays: 2 }),
      step({ stepOrder: 3, type: "WAIT", waitDays: 3 }),
      step({ stepOrder: 4, type: "TASK" }),
    ];
    const result = nextActionableStep(steps, 1);
    expect(result?.step.stepOrder).toBe(4);
    expect(result?.waitDays).toBe(5);
  });

  it("returns null when there are no more actionable steps after the given order", () => {
    const steps = [step({ stepOrder: 1, type: "EMAIL" }), step({ stepOrder: 2, type: "WAIT", waitDays: 3 })];
    expect(nextActionableStep(steps, 1)).toBeNull();
  });

  it("returns zero wait when two actionable steps are adjacent with no WAIT between them", () => {
    const steps = [step({ stepOrder: 1, type: "EMAIL" }), step({ stepOrder: 2, type: "TASK" })];
    const result = nextActionableStep(steps, 1);
    expect(result).toEqual({ step: steps[1], waitDays: 0 });
  });
});

describe("previewSteps", () => {
  it("shows every step, including WAIT, with cumulative day offsets", () => {
    const steps = [
      step({ id: "a", stepOrder: 1, type: "EMAIL" }),
      step({ id: "b", stepOrder: 2, type: "WAIT", waitDays: 3 }),
      step({ id: "c", stepOrder: 3, type: "CALL_REMINDER" }),
    ];
    const preview = previewSteps(steps, { a: "Intro template" });
    expect(preview).toEqual([
      { stepOrder: 1, type: "EMAIL", label: "Send email: Intro template", cumulativeDays: 0 },
      { stepOrder: 2, type: "WAIT", label: "Wait 3 day(s)", cumulativeDays: 3 },
      { stepOrder: 3, type: "CALL_REMINDER", label: "Call reminder", cumulativeDays: 3 },
    ]);
  });
});
