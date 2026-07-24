import { describe, it, expect } from "vitest";
import { ONBOARDING_STEPS, visibleOnboardingSteps } from "../../src/lib/onboarding/steps";

describe("visibleOnboardingSteps", () => {
  it("hides every permission-gated step from a user with no permissions", () => {
    const visible = visibleOnboardingSteps(() => false);
    expect(visible.map((s) => s.key)).toEqual(["schedule_follow_up", "review_my_day"]);
  });

  it("shows every step to a user with every permission", () => {
    const visible = visibleOnboardingSteps(() => true);
    expect(visible).toHaveLength(ONBOARDING_STEPS.length);
  });

  it("shows only the steps a permission unlocks", () => {
    const visible = visibleOnboardingSteps((key) => key === "add_leads");
    expect(visible.map((s) => s.key)).toEqual(["add_first_company", "schedule_follow_up", "review_my_day"]);
  });

  it("every step has a non-empty label, description, and href", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
      expect(step.href.startsWith("/")).toBe(true);
    }
  });

  it("has no duplicate step keys", () => {
    const keys = ONBOARDING_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
