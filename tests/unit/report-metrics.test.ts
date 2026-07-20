import { describe, it, expect } from "vitest";
import {
  computeRate,
  computeStageDurations,
  averageDurationByStage,
  msToDays,
  isStalled,
  MIN_SAMPLE_SIZE_FOR_RATE,
} from "../../src/lib/reports/metrics";

describe("computeRate", () => {
  it("computes a normal rate above the sample-size floor", () => {
    const result = computeRate(6, 10);
    expect(result).toEqual({ suppressed: false, rate: 0.6, numerator: 6, denominator: 10 });
  });

  it("suppresses a rate with a zero denominator instead of showing 0%", () => {
    const result = computeRate(0, 0);
    expect(result).toEqual({ suppressed: true, numerator: 0, denominator: 0, reason: "no_data" });
  });

  it("suppresses a rate below the minimum sample size", () => {
    const result = computeRate(1, MIN_SAMPLE_SIZE_FOR_RATE - 1);
    expect(result.suppressed).toBe(true);
    if (result.suppressed) expect(result.reason).toBe("insufficient_sample");
  });

  it("shows a rate exactly at the minimum sample size", () => {
    const result = computeRate(2, MIN_SAMPLE_SIZE_FOR_RATE);
    expect(result.suppressed).toBe(false);
  });

  it("honors a custom minimum sample size", () => {
    const result = computeRate(1, 2, 2);
    expect(result.suppressed).toBe(false);
  });
});

describe("computeStageDurations", () => {
  it("computes duration between consecutive stage changes and leaves the final stage open until asOf", () => {
    const asOf = new Date("2026-01-10T00:00:00Z");
    const history = [
      { toStageId: "new", changedAt: new Date("2026-01-01T00:00:00Z") },
      { toStageId: "demo", changedAt: new Date("2026-01-04T00:00:00Z") },
      { toStageId: "won", changedAt: new Date("2026-01-08T00:00:00Z") },
    ];
    const durations = computeStageDurations(history, asOf);
    expect(durations).toEqual([
      {
        stageId: "new",
        enteredAt: new Date("2026-01-01T00:00:00Z"),
        exitedAt: new Date("2026-01-04T00:00:00Z"),
        durationMs: 3 * 24 * 60 * 60 * 1000,
      },
      {
        stageId: "demo",
        enteredAt: new Date("2026-01-04T00:00:00Z"),
        exitedAt: new Date("2026-01-08T00:00:00Z"),
        durationMs: 4 * 24 * 60 * 60 * 1000,
      },
      {
        stageId: "won",
        enteredAt: new Date("2026-01-08T00:00:00Z"),
        exitedAt: asOf,
        durationMs: 2 * 24 * 60 * 60 * 1000,
      },
    ]);
  });

  it("sorts out-of-order history before computing durations", () => {
    const history = [
      { toStageId: "demo", changedAt: new Date("2026-01-04T00:00:00Z") },
      { toStageId: "new", changedAt: new Date("2026-01-01T00:00:00Z") },
    ];
    const durations = computeStageDurations(history, new Date("2026-01-05T00:00:00Z"));
    expect(durations[0].stageId).toBe("new");
    expect(durations[1].stageId).toBe("demo");
  });

  it("returns an empty array for a company with no history rows", () => {
    expect(computeStageDurations([], new Date())).toEqual([]);
  });
});

describe("averageDurationByStage", () => {
  it("averages duration per stage across multiple companies' visits", () => {
    const durations = [
      { stageId: "new", enteredAt: new Date(), exitedAt: new Date(), durationMs: 1000 },
      { stageId: "new", enteredAt: new Date(), exitedAt: new Date(), durationMs: 3000 },
      { stageId: "demo", enteredAt: new Date(), exitedAt: new Date(), durationMs: 5000 },
    ];
    const averages = averageDurationByStage(durations);
    expect(averages).toContainEqual({ stageId: "new", totalMs: 4000, visitCount: 2, averageMs: 2000 });
    expect(averages).toContainEqual({ stageId: "demo", totalMs: 5000, visitCount: 1, averageMs: 5000 });
  });

  it("returns an empty array for no durations", () => {
    expect(averageDurationByStage([])).toEqual([]);
  });
});

describe("msToDays", () => {
  it("converts milliseconds to days", () => {
    expect(msToDays(2 * 24 * 60 * 60 * 1000)).toBe(2);
  });
});

describe("isStalled", () => {
  it("is true once the current stage has been open longer than the threshold", () => {
    const enteredAt = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-20T00:00:00Z");
    expect(isStalled(enteredAt, 14, asOf)).toBe(true);
  });

  it("is false while still within the threshold", () => {
    const enteredAt = new Date("2026-01-01T00:00:00Z");
    const asOf = new Date("2026-01-10T00:00:00Z");
    expect(isStalled(enteredAt, 14, asOf)).toBe(false);
  });
});
