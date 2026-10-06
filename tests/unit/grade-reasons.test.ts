import { describe, it, expect } from "vitest";
import { explainGrade, GRADE_BANDS } from "../../src/lib/eos/grade-reasons";
import { gradeForScore } from "../../src/lib/eos/validation";
import type { EosCategoryScores } from "../../src/lib/eos/constants";

// Totals 72: strong food/weeknight, weak marketing/decision-maker.
const scores: EosCategoryScores = {
  foodBeverageFocus: 14,
  weeknightRevenueOpportunity: 13,
  communityEngagement: 7,
  existingEventCulture: 6,
  groupSeatingLayout: 8,
  capacityOperationalSuitability: 7,
  decisionMakerAccessibility: 3,
  marketingActivityVisibility: 4,
  turnkeyImplementationReadiness: 5,
  competitiveOpportunity: 5,
};

describe("explainGrade", () => {
  it("uses the same grade cut-offs as gradeForScore for every possible score", () => {
    for (let score = 0; score <= 100; score++) {
      expect(explainGrade({ eosTotal: score, categoryScores: scores, noTvs: false }).grade).toBe(gradeForScore(score));
    }
    expect(GRADE_BANDS.map((band) => band.grade)).toEqual(["A_PLUS", "A", "B", "C", "D"]);
  });

  it("gives the grade's range and how far the next grade up is", () => {
    const reasons = explainGrade({ eosTotal: 72, categoryScores: scores, noTvs: false });
    expect(reasons).toMatchObject({ grade: "B", band: { min: 70, max: 79 }, nextGrade: { grade: "A", pointsNeeded: 8 } });
    expect(explainGrade({ eosTotal: 95, categoryScores: scores, noTvs: false }).nextGrade).toBeNull();
  });

  it("lists what carried the score and what held it back, with the newest evidence for each", () => {
    const reasons = explainGrade({
      eosTotal: 72,
      categoryScores: scores,
      noTvs: false,
      evidence: [
        { category: "DECISION_MAKER_ACCESSIBILITY", evidenceSummary: "No owner or manager named anywhere online." },
        { category: "DECISION_MAKER_ACCESSIBILITY", evidenceSummary: "Older, superseded note." },
        { category: "FOOD_BEVERAGE_FOCUS", evidenceSummary: "Full kitchen and a craft beer list." },
      ],
    });

    // 100% before 93%/87%; turnkey and competitive are both 5/5.
    expect(reasons.strengths.map((r) => r.key)).toEqual(["turnkeyImplementationReadiness", "competitiveOpportunity", "foodBeverageFocus"]);
    expect(reasons.strengths[2].evidence).toBe("Full kitchen and a craft beer list.");
    // Most points lost first: decision-maker (7), marketing (6), then event culture (4).
    expect(reasons.holdbacks.map((r) => [r.key, r.score, r.max])).toEqual([
      ["decisionMakerAccessibility", 3, 10],
      ["marketingActivityVisibility", 4, 10],
      ["existingEventCulture", 6, 10],
    ]);
    expect(reasons.holdbacks[0].evidence).toBe("No owner or manager named anywhere online.");
    expect(reasons.holdbacks[1].evidence).toBeNull();
    expect(reasons.overrides).toEqual([]);
  });

  it("explains the no-TVs override", () => {
    const reasons = explainGrade({ eosTotal: 67, categoryScores: { ...scores, turnkeyImplementationReadiness: 0 }, noTvs: true });
    expect(reasons.overrides).toEqual(["No TVs or screens confirmed, so Turnkey implementation readiness was set to 0 (trivia needs a screen)."]);
    expect(reasons.holdbacks[0].key).toBe("decisionMakerAccessibility");
  });
});
