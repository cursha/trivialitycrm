import { describe, it, expect } from "vitest";
import {
  gradeForScore,
  gradeMatchesScore,
  validateCategoryScores,
  totalFromCategoryScores,
  validateEosTotal,
  hasConflictingClassification,
  isEligibleForActiveRanking,
} from "../../src/lib/eos/validation";
import type { EosCategoryScores } from "../../src/lib/eos/constants";

function fullScores(overrides: Partial<EosCategoryScores> = {}): EosCategoryScores {
  return {
    foodBeverageFocus: 15,
    weeknightRevenueOpportunity: 15,
    communityEngagement: 10,
    existingEventCulture: 10,
    groupSeatingLayout: 10,
    capacityOperationalSuitability: 10,
    decisionMakerAccessibility: 10,
    marketingActivityVisibility: 10,
    turnkeyImplementationReadiness: 5,
    competitiveOpportunity: 5,
    ...overrides,
  };
}

describe("gradeForScore", () => {
  it("maps grade boundaries per the EOS-1.0 spec", () => {
    expect(gradeForScore(100)).toBe("A_PLUS");
    expect(gradeForScore(90)).toBe("A_PLUS");
    expect(gradeForScore(89)).toBe("A");
    expect(gradeForScore(80)).toBe("A");
    expect(gradeForScore(79)).toBe("B");
    expect(gradeForScore(70)).toBe("B");
    expect(gradeForScore(69)).toBe("C");
    expect(gradeForScore(60)).toBe("C");
    expect(gradeForScore(59)).toBe("D");
    expect(gradeForScore(0)).toBe("D");
  });

  it("rejects scores outside 0-100", () => {
    expect(() => gradeForScore(-1)).toThrow(RangeError);
    expect(() => gradeForScore(101)).toThrow(RangeError);
  });
});

describe("gradeMatchesScore", () => {
  it("confirms a grade matches its score", () => {
    expect(gradeMatchesScore(95, "A_PLUS")).toBe(true);
    expect(gradeMatchesScore(95, "A")).toBe(false);
  });
});

describe("validateCategoryScores", () => {
  it("accepts scores at exactly the maximum for every category", () => {
    expect(validateCategoryScores(fullScores())).toEqual([]);
  });

  it("rejects a category above its maximum", () => {
    const errors = validateCategoryScores(fullScores({ foodBeverageFocus: 16 }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/cannot exceed 15/);
  });

  it("rejects a category below zero", () => {
    const errors = validateCategoryScores(fullScores({ competitiveOpportunity: -1 }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/cannot be below 0/);
  });

  it("reports every violated category, not just the first", () => {
    const errors = validateCategoryScores(fullScores({ foodBeverageFocus: 20, competitiveOpportunity: -3 }));
    expect(errors).toHaveLength(2);
  });
});

describe("totalFromCategoryScores / validateEosTotal", () => {
  it("sums all ten categories to 100 at maximum", () => {
    expect(totalFromCategoryScores(fullScores())).toBe(100);
  });

  it("passes when the stated total equals the computed sum", () => {
    const scores = fullScores({ foodBeverageFocus: 0 });
    expect(validateEosTotal(85, scores)).toEqual([]);
  });

  it("fails when the stated total does not equal the computed sum", () => {
    const scores = fullScores();
    const errors = validateEosTotal(50, scores);
    expect(errors.some((e) => e.includes("must equal the sum"))).toBe(true);
  });

  it("fails when the total falls outside 0-100", () => {
    const scores = fullScores();
    // totalFromCategoryScores(scores) is 100 here, so pass a mismatched,
    // out-of-range total to trigger the bound check independently.
    const errors = validateEosTotal(150, scores);
    expect(errors.some((e) => e.includes("between 0 and 100"))).toBe(true);
  });
});

describe("hasConflictingClassification", () => {
  it("flags Replacement and Entertainment-Ready appearing together", () => {
    expect(hasConflictingClassification(["REPLACEMENT", "ENTERTAINMENT_READY"])).toBe(true);
  });

  it("allows either alone", () => {
    expect(hasConflictingClassification(["REPLACEMENT"])).toBe(false);
    expect(hasConflictingClassification(["ENTERTAINMENT_READY"])).toBe(false);
    expect(hasConflictingClassification(["GREENFIELD", "NEEDS_QUALIFICATION"])).toBe(false);
  });
});

describe("isEligibleForActiveRanking", () => {
  it("excludes existing customers", () => {
    expect(isEligibleForActiveRanking({ isExistingCustomer: true, doNotContact: false })).toBe(false);
  });

  it("excludes do-not-contact companies", () => {
    expect(isEligibleForActiveRanking({ isExistingCustomer: false, doNotContact: true })).toBe(false);
  });

  it("includes an ordinary active prospect", () => {
    expect(isEligibleForActiveRanking({ isExistingCustomer: false, doNotContact: false })).toBe(true);
  });
});
