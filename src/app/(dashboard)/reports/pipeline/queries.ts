// No `import "server-only"` — the worker (via src/lib/reports/build-rows.ts)
// needs this module too; see src/lib/prisma.ts for the same reasoning.
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope } from "@/lib/reports/scope";
import { resolveReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { computeStageDurations, averageDurationByStage, msToDays, isStalled, computeRate, type RateResult } from "@/lib/reports/metrics";

const SOURCE_LABELS: Record<string, string> = { MANUAL: "Manual", AI_RESEARCH: "AI Research", IMPORT: "Import" };

export async function getPipelineReport(user: AuthenticatedUser, filters: ReportFilters, stalledThresholdDays: number) {
  const scope = reportScope(user);
  if (!scope) return null;

  const { dateRange, companyWhere: companyScopeWhere } = await resolveReportFilters(filters, scope);
  const stageHistoryScope = { company: companyScopeWhere };
  const rangeWhere = { changedAt: { gte: dateRange.start, lt: dateRange.end } };
  const now = new Date();

  const [
    stages,
    allHistory,
    entriesInRange,
    exitsInRange,
    lossReasonGroups,
    unrecordedLossCount,
    decidedInRange,
    leadTypes,
    stalledCandidates,
    currentPipelineGroups,
  ] = await Promise.all([
    prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStageHistory.findMany({
      where: stageHistoryScope,
      orderBy: [{ companyId: "asc" }, { changedAt: "asc" }],
      select: { companyId: true, fromStageId: true, toStageId: true, changedAt: true },
    }),
    prisma.pipelineStageHistory.groupBy({ by: ["toStageId"], where: { AND: [stageHistoryScope, rangeWhere] }, _count: true }),
    prisma.pipelineStageHistory.groupBy({
      by: ["fromStageId"],
      where: { AND: [stageHistoryScope, rangeWhere, { fromStageId: { not: null } }] },
      _count: true,
    }),
    prisma.pipelineStageHistory.groupBy({
      by: ["lossReasonId"],
      where: { AND: [stageHistoryScope, rangeWhere, { toStage: { outcomeType: "LOST" } }, { lossReasonId: { not: null } }] },
      _count: true,
    }),
    prisma.pipelineStageHistory.count({
      where: { AND: [stageHistoryScope, rangeWhere, { toStage: { outcomeType: "LOST" } }, { lossReasonId: null }] },
    }),
    prisma.pipelineStageHistory.findMany({
      where: { AND: [stageHistoryScope, rangeWhere, { toStage: { outcomeType: { in: ["WON", "LOST"] } } }] },
      select: { toStageId: true, company: { select: { leadTypeId: true, source: true, assignedToId: true } } },
    }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.company.findMany({
      where: { AND: [companyScopeWhere, { status: (filters.status ?? "ACTIVE") as "ACTIVE" | "ARCHIVED" }, { pipelineStage: { outcomeType: null } }] },
      select: { id: true, name: true, pipelineStageId: true },
    }),
    prisma.company.groupBy({
      by: ["pipelineStageId"],
      where: { AND: [companyScopeWhere, { status: (filters.status ?? "ACTIVE") as "ACTIVE" | "ARCHIVED" }] },
      _count: true,
    }),
  ]);

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const rejectionReasons = await prisma.rejectionReason.findMany();
  const reasonNameById = new Map(rejectionReasons.map((r) => [r.id, r.name]));
  const salespeople = await prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } });
  const userNameById = new Map(salespeople.map((u) => [u.id, u.name]));
  const leadTypeNameById = new Map(leadTypes.map((t) => [t.id, t.name]));

  const currentPipelineBreakdown = currentPipelineGroups
    .map((g) => ({ stageId: g.pipelineStageId, stageName: stageById.get(g.pipelineStageId)?.name ?? "Unknown", count: g._count }))
    .sort((a, b) => (stageById.get(a.stageId)?.sortOrder ?? 0) - (stageById.get(b.stageId)?.sortOrder ?? 0));

  const entriesByStage = entriesInRange.map((g) => ({
    stageId: g.toStageId,
    stageName: stageById.get(g.toStageId)?.name ?? "Unknown",
    count: g._count,
  }));
  const exitsByStage = exitsInRange
    .filter((g): g is typeof g & { fromStageId: string } => g.fromStageId !== null)
    .map((g) => ({ stageId: g.fromStageId, stageName: stageById.get(g.fromStageId)?.name ?? "Unknown", count: g._count }));

  // Per-company stage-visit durations, computed from every history row this
  // viewer may see (not date-ranged — "avg days in stage" describes the
  // stage itself, not a period). Only companies with at least one history
  // row contribute; a company created before Module Five shipped and never
  // moved since has no rows and is correctly excluded rather than guessed.
  const historyByCompany = new Map<string, { toStageId: string; changedAt: Date }[]>();
  for (const h of allHistory) {
    const arr = historyByCompany.get(h.companyId) ?? [];
    arr.push({ toStageId: h.toStageId, changedAt: h.changedAt });
    historyByCompany.set(h.companyId, arr);
  }
  const allDurations = Array.from(historyByCompany.values()).flatMap((entries) => computeStageDurations(entries, now));
  const avgDaysByStage = averageDurationByStage(allDurations)
    .map((a) => ({ stageId: a.stageId, stageName: stageById.get(a.stageId)?.name ?? "Unknown", avgDays: Math.round(msToDays(a.averageMs) * 10) / 10, visitCount: a.visitCount }))
    .sort((a, b) => (stageById.get(a.stageId)?.sortOrder ?? 0) - (stageById.get(b.stageId)?.sortOrder ?? 0));

  let stalledCount = 0;
  let stalledUntracked = 0;
  for (const company of stalledCandidates) {
    const entries = historyByCompany.get(company.id);
    const lastEntry = entries?.[entries.length - 1];
    if (!lastEntry || lastEntry.toStageId !== company.pipelineStageId) {
      stalledUntracked += 1;
      continue;
    }
    if (isStalled(lastEntry.changedAt, stalledThresholdDays, now)) stalledCount += 1;
  }

  const lossReasonBreakdown = [
    ...lossReasonGroups.map((g) => ({ label: reasonNameById.get(g.lossReasonId!) ?? "Unknown", count: g._count })),
    ...(unrecordedLossCount > 0 ? [{ label: "Not recorded", count: unrecordedLossCount }] : []),
  ];

  // Stage-to-stage "conversion": among companies that ever visited stage N
  // (all-time, in scope), the share that also ever visited stage N+1. This
  // is co-occurrence, not strict same-cohort sequencing — a company that
  // skipped stage N via an admin correction still counts as "reached." That
  // caveat is documented here and in REPORT_DEFINITIONS.md, not hidden.
  const companyIdsByStage = new Map<string, Set<string>>();
  for (const h of allHistory) {
    const set = companyIdsByStage.get(h.toStageId) ?? new Set<string>();
    set.add(h.companyId);
    companyIdsByStage.set(h.toStageId, set);
  }
  const orderedActiveStages = stages.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const stageConversions: { from: string; to: string; result: RateResult }[] = [];
  for (let i = 0; i < orderedActiveStages.length - 1; i++) {
    const fromSet = companyIdsByStage.get(orderedActiveStages[i].id) ?? new Set<string>();
    const toSet = companyIdsByStage.get(orderedActiveStages[i + 1].id) ?? new Set<string>();
    let reached = 0;
    for (const id of fromSet) if (toSet.has(id)) reached += 1;
    stageConversions.push({ from: orderedActiveStages[i].name, to: orderedActiveStages[i + 1].name, result: computeRate(reached, fromSet.size) });
  }

  // New -> Won: of companies that FIRST entered the pipeline during the
  // selected range (fromStageId null, changedAt in range), the share that
  // have reached a WON stage as of now (not necessarily within the same
  // range — deals opened and closed in the same short window are rare, so
  // constraining both ends to the range would make this near-always 0%).
  const cohortIds = new Set<string>();
  for (const h of allHistory) {
    if (h.fromStageId === null && h.changedAt >= dateRange.start && h.changedAt < dateRange.end) cohortIds.add(h.companyId);
  }
  const wonStageIds = new Set(stages.filter((s) => s.outcomeType === "WON").map((s) => s.id));
  const wonCompanyIds = new Set<string>();
  for (const [stageId, ids] of companyIdsByStage) {
    if (wonStageIds.has(stageId)) for (const id of ids) wonCompanyIds.add(id);
  }
  let cohortWon = 0;
  for (const id of cohortIds) if (wonCompanyIds.has(id)) cohortWon += 1;
  const newToWonRate = computeRate(cohortWon, cohortIds.size);

  // Win rate among decided (WON or LOST) leads in range, by dimension.
  function rateByKey<K extends string>(keyOf: (row: (typeof decidedInRange)[number]) => K | null, labelFor: (key: K) => string) {
    const counts = new Map<K, { won: number; total: number }>();
    for (const row of decidedInRange) {
      const key = keyOf(row);
      if (key === null) continue;
      const outcome = stageById.get(row.toStageId)?.outcomeType;
      const entry = counts.get(key) ?? { won: 0, total: 0 };
      entry.total += 1;
      if (outcome === "WON") entry.won += 1;
      counts.set(key, entry);
    }
    return Array.from(counts.entries()).map(([key, c]) => ({ label: labelFor(key), result: computeRate(c.won, c.total) }));
  }

  const winRateByLeadType = rateByKey(
    (row) => row.company.leadTypeId,
    (id) => leadTypeNameById.get(id) ?? "Unknown",
  );
  const winRateBySource = rateByKey(
    (row) => row.company.source,
    (source) => SOURCE_LABELS[source] ?? source,
  );
  const winRateBySalesperson = rateByKey(
    (row) => row.company.assignedToId,
    (id) => userNameById.get(id) ?? "Unassigned",
  );

  return {
    currentPipelineBreakdown,
    entriesByStage,
    exitsByStage,
    avgDaysByStage,
    stalledCount,
    stalledUntracked,
    lossReasonBreakdown,
    stageConversions,
    newToWonRate,
    winRateByLeadType,
    winRateBySource,
    winRateBySalesperson,
  };
}
