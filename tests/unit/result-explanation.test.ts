import { describe, it, expect } from "vitest";
import {
  isMockResearchResult,
  computeResultConfidence,
  recommendResultNextAction,
} from "../../src/lib/research/result-explanation";

describe("isMockResearchResult", () => {
  it("detects a mock result via the score explanation marker", () => {
    expect(isMockResearchResult("[Mock score] base 60 + evidence 10 + trivia signal 0.", [])).toBe(true);
  });

  it("detects a mock result via an evidence note marker even if the explanation looks real", () => {
    const evidence = [{ verificationStatus: "UNVERIFIED", note: "[Mock evidence] Candidate matches..." }];
    expect(isMockResearchResult("Scored based on live research.", evidence)).toBe(true);
  });

  it("does not flag a real result as mock", () => {
    const evidence = [{ verificationStatus: "VERIFIED", note: "Confirmed via the business's public website." }];
    expect(isMockResearchResult("Strong trivia signal and verified contact info.", evidence)).toBe(false);
  });
});

describe("computeResultConfidence", () => {
  it("is LOW when there is no evidence", () => {
    expect(computeResultConfidence([])).toBe("LOW");
  });

  it("is LOW when every entry is unverified", () => {
    const evidence = [
      { verificationStatus: "UNVERIFIED", note: "a" },
      { verificationStatus: "UNVERIFIED", note: "b" },
    ];
    expect(computeResultConfidence(evidence)).toBe("LOW");
  });

  it("is HIGH when at least half of 2+ entries are verified", () => {
    const evidence = [
      { verificationStatus: "VERIFIED", note: "a" },
      { verificationStatus: "VERIFIED", note: "b" },
      { verificationStatus: "INFERRED", note: "c" },
    ];
    expect(computeResultConfidence(evidence)).toBe("HIGH");
  });

  it("is not HIGH from a single verified entry alone", () => {
    expect(computeResultConfidence([{ verificationStatus: "VERIFIED", note: "a" }])).toBe("MEDIUM");
  });

  it("is MEDIUM for a mix that is neither all-unverified nor half-verified", () => {
    const evidence = [
      { verificationStatus: "INFERRED", note: "a" },
      { verificationStatus: "UNVERIFIED", note: "b" },
    ];
    expect(computeResultConfidence(evidence)).toBe("MEDIUM");
  });
});

describe("recommendResultNextAction", () => {
  const base = { disposition: "NEW", score: 90, minimumScore: 80, triviaStatus: "TRIVIA_CONFIRMED", evidenceCount: 3 };

  it("recommends restoring first for a rejected result", () => {
    expect(recommendResultNextAction({ ...base, disposition: "REJECTED" })).toMatch(/restore/i);
  });

  it("notes an already-transferred result needs no action", () => {
    expect(recommendResultNextAction({ ...base, disposition: "TRANSFERRED" })).toMatch(/already transferred/i);
  });

  it("notes a duplicate result needs no action", () => {
    expect(recommendResultNextAction({ ...base, disposition: "DUPLICATE" })).toMatch(/duplicate/i);
  });

  it("recommends running research when there is no evidence", () => {
    expect(recommendResultNextAction({ ...base, evidenceCount: 0 })).toMatch(/run research/i);
  });

  it("recommends more research when trivia status is still uncertain", () => {
    expect(recommendResultNextAction({ ...base, triviaStatus: "UNCERTAIN" })).toMatch(/uncertain/i);
  });

  it("warns when the score is below the search's minimum", () => {
    expect(recommendResultNextAction({ ...base, score: 50 })).toMatch(/below this search's minimum score \(80\)/i);
  });

  it("recommends transferring when everything checks out", () => {
    expect(recommendResultNextAction(base)).toMatch(/ready to select and transfer/i);
  });
});
