// Deterministic "What should I do next?" ordering for the Salesperson Home
// Page. Pure — no DB access — so it's unit-tested directly. Callers (the
// dashboard query layer) are responsible for fetching and pre-filtering
// each bucket's candidates (scope, thresholds, archived-company exclusion);
// this function only orders and labels what it's given.
//
// Documented priority (fixed, not AI-generated):
//   1. Overdue follow-ups           — most overdue first
//   2. Follow-ups due today         — earliest first
//   3. Active trials needing attention — longest-untouched trial first
//   4. Newly assigned, not yet contacted — oldest assignment first
//   5. Leads with no recent activity   — longest-stale first
//   6. Upcoming follow-ups (next UPCOMING_WINDOW_DAYS days) — earliest first

/** How many days ahead "upcoming follow-ups" looks — a code constant, not a
 * WorkspaceSettings field: low-stakes enough that a settings UI for it
 * isn't justified. */
export const UPCOMING_WINDOW_DAYS = 7;

export type PriorityTask = {
  id: string;
  companyId: string;
  companyName: string;
  dueAt: Date;
};

export type PriorityTrialCompany = {
  companyId: string;
  companyName: string;
  lastTrialActivityAt: Date;
};

export type PriorityNewAssignment = {
  companyId: string;
  companyName: string;
  assignedAt: Date;
};

export type PriorityStaleCompany = {
  companyId: string;
  companyName: string;
  lastActivityAt: Date;
};

export type PriorityInput = {
  /** status OPEN, dueAt < start of today, company ACTIVE */
  overdueTasks: PriorityTask[];
  /** status OPEN, dueAt within [start of today, start of tomorrow), company ACTIVE */
  dueTodayTasks: PriorityTask[];
  /** current stage outcomeType is null, most recent activity of type TRIAL, no currently-OPEN task */
  activeTrials: PriorityTrialCompany[];
  /** most recent ASSIGNMENT_CHANGE assigning to this user is within the newly-assigned threshold, no other activity since */
  newAssignments: PriorityNewAssignment[];
  /** last activity (or createdAt if none) older than the no-activity threshold */
  staleCompanies: PriorityStaleCompany[];
  /** status OPEN, dueAt within [start of tomorrow, start of tomorrow + UPCOMING_WINDOW_DAYS days) */
  upcomingTasks: PriorityTask[];
};

export type PriorityItem =
  | { bucket: "OVERDUE_FOLLOW_UP"; task: PriorityTask }
  | { bucket: "DUE_TODAY"; task: PriorityTask }
  | { bucket: "ACTIVE_TRIAL"; company: PriorityTrialCompany }
  | { bucket: "NEWLY_ASSIGNED"; company: PriorityNewAssignment }
  | { bucket: "NO_RECENT_ACTIVITY"; company: PriorityStaleCompany }
  | { bucket: "UPCOMING_FOLLOW_UP"; task: PriorityTask };

function byTimeAscending<T>(getTime: (item: T) => Date) {
  return (a: T, b: T) => getTime(a).getTime() - getTime(b).getTime();
}

export function computeDailyPriorityList(input: PriorityInput): PriorityItem[] {
  const overdue = [...input.overdueTasks].sort(byTimeAscending((t) => t.dueAt));
  const dueToday = [...input.dueTodayTasks].sort(byTimeAscending((t) => t.dueAt));
  const trials = [...input.activeTrials].sort(byTimeAscending((c) => c.lastTrialActivityAt));
  const newAssignments = [...input.newAssignments].sort(byTimeAscending((c) => c.assignedAt));
  const stale = [...input.staleCompanies].sort(byTimeAscending((c) => c.lastActivityAt));
  const upcoming = [...input.upcomingTasks].sort(byTimeAscending((t) => t.dueAt));

  return [
    ...overdue.map((task): PriorityItem => ({ bucket: "OVERDUE_FOLLOW_UP", task })),
    ...dueToday.map((task): PriorityItem => ({ bucket: "DUE_TODAY", task })),
    ...trials.map((company): PriorityItem => ({ bucket: "ACTIVE_TRIAL", company })),
    ...newAssignments.map((company): PriorityItem => ({ bucket: "NEWLY_ASSIGNED", company })),
    ...stale.map((company): PriorityItem => ({ bucket: "NO_RECENT_ACTIVITY", company })),
    ...upcoming.map((task): PriorityItem => ({ bucket: "UPCOMING_FOLLOW_UP", task })),
  ];
}
