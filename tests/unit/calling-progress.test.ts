import { describe, it, expect } from "vitest";
import { nextEntryToOffer, summarizeEntryCounts } from "../../src/lib/calling/progress";

describe("nextEntryToOffer", () => {
  it("returns the first pending entry at or after the current position", () => {
    const entries = [
      { id: "a", position: 0, status: "COMPLETED" as const },
      { id: "b", position: 1, status: "PENDING" as const },
      { id: "c", position: 2, status: "PENDING" as const },
    ];
    expect(nextEntryToOffer(entries, 0)?.id).toBe("b");
    expect(nextEntryToOffer(entries, 2)?.id).toBe("c");
  });

  it("wraps around to the earliest pending entry once every later position has been passed", () => {
    const entries = [
      { id: "a", position: 0, status: "PENDING" as const }, // skipped temporarily earlier
      { id: "b", position: 1, status: "COMPLETED" as const },
      { id: "c", position: 2, status: "COMPLETED" as const },
    ];
    expect(nextEntryToOffer(entries, 3)?.id).toBe("a");
  });

  it("returns null once nothing is pending", () => {
    const entries = [
      { id: "a", position: 0, status: "COMPLETED" as const },
      { id: "b", position: 1, status: "SKIPPED" as const },
    ];
    expect(nextEntryToOffer(entries, 0)).toBeNull();
  });
});

describe("summarizeEntryCounts", () => {
  it("counts total/completed/remaining/skipped", () => {
    const entries = [
      { id: "a", position: 0, status: "COMPLETED" as const },
      { id: "b", position: 1, status: "PENDING" as const },
      { id: "c", position: 2, status: "SKIPPED" as const },
      { id: "d", position: 3, status: "PENDING" as const },
    ];
    expect(summarizeEntryCounts(entries)).toEqual({ total: 4, completed: 1, remaining: 2, skipped: 1 });
  });
});
