/**
 * Pure calculators shared by every report query. Deliberately has no Prisma
 * import and no "server-only" guard — every function here takes plain data
 * in and returns plain data out, so it can be unit-tested in isolation from
 * Postgres (see tests/unit/report-metrics.test.ts) and reused identically
 * by both the interactive report pages and the scheduled-report worker
 * handler.
 */

/** Below this denominator, a rate is suppressed rather than shown — a
 * "50%" built from 1 of 2 leads is misleading. Documented in
 * REPORT_DEFINITIONS.md; change here if the business wants a different
 * threshold. */
export const MIN_SAMPLE_SIZE_FOR_RATE = 5;

export type RateResult =
  | { suppressed: false; rate: number; numerator: number; denominator: number }
  | { suppressed: true; numerator: number; denominator: number; reason: "no_data" | "insufficient_sample" };

/** Never divides by zero, never silently treats "no data" as 0%. */
export function computeRate(
  numerator: number,
  denominator: number,
  minSampleSize: number = MIN_SAMPLE_SIZE_FOR_RATE,
): RateResult {
  if (denominator === 0) return { suppressed: true, numerator, denominator, reason: "no_data" };
  if (denominator < minSampleSize) return { suppressed: true, numerator, denominator, reason: "insufficient_sample" };
  return { suppressed: false, rate: numerator / denominator, numerator, denominator };
}

export type StageHistoryEntry = { toStageId: string; changedAt: Date };
export type StageDuration = { stageId: string; enteredAt: Date; exitedAt: Date; durationMs: number };

/**
 * Turns one company's chronological PipelineStageHistory rows into a
 * per-stage-visit duration list. The final entry's duration runs to `asOf`
 * (the current stage is still "open"). Callers must pass only history rows
 * that exist — this performs no backfill/estimation for periods before the
 * company's first recorded history row.
 */
export function computeStageDurations(history: StageHistoryEntry[], asOf: Date = new Date()): StageDuration[] {
  const sorted = [...history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  return sorted.map((entry, index) => {
    const exitedAt = index + 1 < sorted.length ? sorted[index + 1].changedAt : asOf;
    return {
      stageId: entry.toStageId,
      enteredAt: entry.changedAt,
      exitedAt,
      durationMs: Math.max(0, exitedAt.getTime() - entry.changedAt.getTime()),
    };
  });
}

export type StageAverage = { stageId: string; totalMs: number; visitCount: number; averageMs: number };

/** Aggregates computeStageDurations() output across many companies into a
 * per-stage average — the building block for "avg days in stage". */
export function averageDurationByStage(durations: StageDuration[]): StageAverage[] {
  const byStage = new Map<string, { totalMs: number; visitCount: number }>();
  for (const d of durations) {
    const existing = byStage.get(d.stageId) ?? { totalMs: 0, visitCount: 0 };
    existing.totalMs += d.durationMs;
    existing.visitCount += 1;
    byStage.set(d.stageId, existing);
  }
  return Array.from(byStage.entries()).map(([stageId, { totalMs, visitCount }]) => ({
    stageId,
    totalMs,
    visitCount,
    averageMs: totalMs / visitCount,
  }));
}

export function msToDays(ms: number): number {
  return ms / (1000 * 60 * 60 * 24);
}

/** A lead is "stalled" when its current stage's open duration exceeds
 * `thresholdDays` and the stage is not a terminal (Won/Lost) outcome —
 * callers filter out terminal-stage companies before calling this since
 * outcome typing lives on PipelineStage, not in this pure module. */
export function isStalled(currentStageEnteredAt: Date, thresholdDays: number, asOf: Date = new Date()): boolean {
  return msToDays(asOf.getTime() - currentStageEnteredAt.getTime()) > thresholdDays;
}
