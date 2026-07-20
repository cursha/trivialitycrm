import { describe, it, expect } from "vitest";
import { computeDailyPriorityList, type PriorityInput } from "../../src/lib/workspace/priority";

function emptyInput(): PriorityInput {
  return { overdueTasks: [], dueTodayTasks: [], activeTrials: [], newAssignments: [], staleCompanies: [], upcomingTasks: [] };
}

describe("computeDailyPriorityList", () => {
  it("orders buckets: overdue, due today, active trials, newly assigned, no recent activity, upcoming", () => {
    const input: PriorityInput = {
      ...emptyInput(),
      overdueTasks: [{ id: "t1", companyId: "c1", companyName: "Overdue Co", dueAt: new Date("2026-01-01") }],
      dueTodayTasks: [{ id: "t2", companyId: "c2", companyName: "Today Co", dueAt: new Date("2026-01-05") }],
      activeTrials: [{ companyId: "c3", companyName: "Trial Co", lastTrialActivityAt: new Date("2026-01-02") }],
      newAssignments: [{ companyId: "c4", companyName: "New Co", assignedAt: new Date("2026-01-03") }],
      staleCompanies: [{ companyId: "c5", companyName: "Stale Co", lastActivityAt: new Date("2025-12-01") }],
      upcomingTasks: [{ id: "t3", companyId: "c6", companyName: "Upcoming Co", dueAt: new Date("2026-01-10") }],
    };

    const result = computeDailyPriorityList(input);

    expect(result.map((item) => item.bucket)).toEqual([
      "OVERDUE_FOLLOW_UP",
      "DUE_TODAY",
      "ACTIVE_TRIAL",
      "NEWLY_ASSIGNED",
      "NO_RECENT_ACTIVITY",
      "UPCOMING_FOLLOW_UP",
    ]);
  });

  it("sorts overdue follow-ups with the most overdue (oldest dueAt) first", () => {
    const input: PriorityInput = {
      ...emptyInput(),
      overdueTasks: [
        { id: "t1", companyId: "c1", companyName: "Less overdue", dueAt: new Date("2026-01-05") },
        { id: "t2", companyId: "c2", companyName: "Most overdue", dueAt: new Date("2026-01-01") },
        { id: "t3", companyId: "c3", companyName: "Middling", dueAt: new Date("2026-01-03") },
      ],
    };

    const result = computeDailyPriorityList(input);
    const names = result.filter((i) => i.bucket === "OVERDUE_FOLLOW_UP").map((i) => (i.bucket === "OVERDUE_FOLLOW_UP" ? i.task.companyName : ""));
    expect(names).toEqual(["Most overdue", "Middling", "Less overdue"]);
  });

  it("sorts stale companies with the longest-untouched first", () => {
    const input: PriorityInput = {
      ...emptyInput(),
      staleCompanies: [
        { companyId: "c1", companyName: "Recently stale", lastActivityAt: new Date("2025-12-20") },
        { companyId: "c2", companyName: "Very stale", lastActivityAt: new Date("2025-10-01") },
      ],
    };

    const result = computeDailyPriorityList(input);
    const names = result.map((i) => (i.bucket === "NO_RECENT_ACTIVITY" ? i.company.companyName : ""));
    expect(names).toEqual(["Very stale", "Recently stale"]);
  });

  it("returns an empty list when every bucket is empty", () => {
    expect(computeDailyPriorityList(emptyInput())).toEqual([]);
  });

  it("does not mutate the input arrays", () => {
    const input: PriorityInput = {
      ...emptyInput(),
      overdueTasks: [
        { id: "t1", companyId: "c1", companyName: "B", dueAt: new Date("2026-01-05") },
        { id: "t2", companyId: "c2", companyName: "A", dueAt: new Date("2026-01-01") },
      ],
    };
    const originalOrder = input.overdueTasks.map((t) => t.companyName);
    computeDailyPriorityList(input);
    expect(input.overdueTasks.map((t) => t.companyName)).toEqual(originalOrder);
  });
});
