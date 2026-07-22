import { describe, it, expect } from "vitest";
import { similarityScore } from "../../src/lib/data-quality/similarity";

describe("similarityScore", () => {
  it("returns 100 for identical strings", () => {
    expect(similarityScore("the copper kettle", "the copper kettle")).toBe(100);
    expect(similarityScore("", "")).toBe(100);
  });

  it("returns 0 for completely different strings of the same length", () => {
    expect(similarityScore("abc", "xyz")).toBe(0);
  });

  it("scores a near-identical string (one-character typo) highly", () => {
    const score = similarityScore("the copper kettle", "the copper ketle");
    expect(score).toBeGreaterThanOrEqual(90);
    expect(score).toBeLessThan(100);
  });

  it("scores an unrelated pair low", () => {
    const score = similarityScore("the copper kettle", "stonehouse tavern");
    expect(score).toBeLessThan(50);
  });

  it("is symmetric", () => {
    expect(similarityScore("foo bar", "bar foo baz")).toBe(similarityScore("bar foo baz", "foo bar"));
  });
});
