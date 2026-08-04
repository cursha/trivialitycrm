import { describe, it, expect } from "vitest";
import { groupSearchResult, classifyField } from "../../src/lib/research/competition-locator-buckets";

describe("groupSearchResult", () => {
  it("routes a REJECTED result to rejectedUnverified regardless of other fields", () => {
    expect(groupSearchResult({ disposition: "REJECTED", competitorConflict: true, duplicateConfidence: "HIGH" })).toBe("rejectedUnverified");
  });

  it("routes a competitor conflict to competitorConflict even with HIGH duplicate confidence", () => {
    expect(groupSearchResult({ disposition: "NEW", competitorConflict: true, duplicateConfidence: "HIGH" })).toBe("competitorConflict");
  });

  it("routes a HIGH-confidence match with no conflict to existingWithNewInfo", () => {
    expect(groupSearchResult({ disposition: "NEW", competitorConflict: false, duplicateConfidence: "HIGH" })).toBe("existingWithNewInfo");
  });

  it("routes MEDIUM and LOW confidence matches to possibleDuplicate", () => {
    expect(groupSearchResult({ disposition: "NEW", competitorConflict: false, duplicateConfidence: "MEDIUM" })).toBe("possibleDuplicate");
    expect(groupSearchResult({ disposition: "NEW", competitorConflict: false, duplicateConfidence: "LOW" })).toBe("possibleDuplicate");
  });

  it("routes no match at all to new", () => {
    expect(groupSearchResult({ disposition: "NEW", competitorConflict: false, duplicateConfidence: null })).toBe("new");
  });

  it("routes BELOW_SCORE with no match/conflict to new (bucket is about approval readiness, not score)", () => {
    expect(groupSearchResult({ disposition: "BELOW_SCORE", competitorConflict: false, duplicateConfidence: null })).toBe("new");
  });
});

describe("classifyField", () => {
  it("classifies both blank as blank", () => {
    expect(classifyField(null, null)).toBe("blank");
    expect(classifyField("", "  ")).toBe("blank");
  });

  it("classifies existing-blank + new-present as new", () => {
    expect(classifyField(null, "555-0100")).toBe("new");
    expect(classifyField("", "555-0100")).toBe("new");
  });

  it("classifies existing-present + new-blank as identical (nothing to gain)", () => {
    expect(classifyField("555-0100", null)).toBe("identical");
  });

  it("classifies equal non-blank values as identical", () => {
    expect(classifyField("Ontario", "Ontario")).toBe("identical");
  });

  it("classifies different non-blank values as conflicting", () => {
    expect(classifyField("555-0100", "555-0199")).toBe("conflicting");
  });
});
