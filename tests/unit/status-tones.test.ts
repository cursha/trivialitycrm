import { describe, it, expect } from "vitest";
import { toneFor, humanizeEnum, GRADE_TONE, SEARCH_STATUS_TONE } from "../../src/lib/ui/status-tones";

describe("toneFor", () => {
  it("returns the mapped tone for a known key", () => {
    expect(toneFor(GRADE_TONE, "A_PLUS")).toBe("accent");
    expect(toneFor(SEARCH_STATUS_TONE, "FAILED")).toBe("danger");
  });

  it("falls back to neutral for an unmapped key", () => {
    expect(toneFor(GRADE_TONE, "NOT_A_REAL_GRADE" as never)).toBe("neutral");
  });

  it("falls back to a custom default when given", () => {
    expect(toneFor(GRADE_TONE, "NOT_A_REAL_GRADE" as never, "danger")).toBe("danger");
  });

  it("returns the fallback for null/undefined without throwing", () => {
    expect(toneFor(GRADE_TONE, null)).toBe("neutral");
    expect(toneFor(GRADE_TONE, undefined)).toBe("neutral");
  });
});

describe("humanizeEnum", () => {
  it("converts SHOUTING_SNAKE_CASE to Title Case with spaces", () => {
    expect(humanizeEnum("CURRENT_TRIVIA")).toBe("Current Trivia");
    expect(humanizeEnum("BELOW_SCORE")).toBe("Below Score");
  });

  it("handles a single word", () => {
    expect(humanizeEnum("PENDING")).toBe("Pending");
  });
});
