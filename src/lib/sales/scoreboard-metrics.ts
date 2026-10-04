// No "server-only": the Manager page's goal editor (a client component)
// uses these too. See src/lib/sales/scoreboard.ts for how each is counted.

export const SCOREBOARD_METRICS = ["visits", "intros", "demosBooked", "demosHeld", "trialsBooked"] as const;
export type ScoreboardMetric = (typeof SCOREBOARD_METRICS)[number];
export type ScoreCounts = Record<ScoreboardMetric, number>;

export const SCOREBOARD_LABELS: Record<ScoreboardMetric, string> = {
  visits: "Visits (flyer drops)",
  intros: "Long-distance intros",
  demosBooked: "Demos booked",
  demosHeld: "Demos held",
  trialsBooked: "Trials booked",
};

/** Daily goals when a rep has no SalesTarget row — keep in sync with the
 * SalesTarget column defaults in schema.prisma. */
export const DEFAULT_TARGETS: ScoreCounts = { visits: 10, intros: 0, demosBooked: 2, demosHeld: 2, trialsBooked: 1 };
