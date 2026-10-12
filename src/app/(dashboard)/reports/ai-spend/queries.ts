// No `import "server-only"` — the worker (via src/lib/reports/build-rows.ts)
// needs this module too; see src/lib/prisma.ts for the same reasoning.
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { reportScope, reportUserWhere } from "@/lib/reports/scope";
import { resolveValidatedDateRange, type ReportFilters } from "@/lib/reports/filters";
import { zonedCalendarDate } from "@/lib/timezone";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Reports → AI Spend: where the AI money went, from AiUsageRecord (one row
 * per AI call, priced when the call returns). Curt asked for one report
 * showing how the money was spent (2026-10-12) — before this the spend was
 * only a month total on Integrations and a search total on AI Research.
 * Estimates, not the Anthropic bill.
 */

export const AI_OPERATION_LABEL: Record<string, string> = {
  discover: "Lead search: finding venues",
  verify: "Lead search: checking venues",
  score: "Lead search: scoring venues",
  findEmail: "Finding emails (web search)",
  analyzeOpportunity: "Opportunity analysis",
  personalizeCampaign: "Campaign personalisation",
  promptAssist: "Prompt help",
};

export function aiOperationLabel(operation: string): string {
  return AI_OPERATION_LABEL[operation] ?? operation;
}

export const AI_SPEND_CALLS_PAGE_SIZE = 25;

/** Up to two months shows spend per day; anything longer, per month. */
const DAILY_LIMIT_DAYS = 62;

/** Which usage rows the viewer may see. Calls with no person (system jobs)
 * only show under the all-reports scope, since they belong to no team. */
function usageScopeWhere(user: AuthenticatedUser): Prisma.AiUsageRecordWhereInput | null {
  const scope = reportScope(user);
  if (!scope) return null;
  return scope.tier === "all" ? {} : { user: reportUserWhere(scope) };
}

type SpendRow = { label: string; costUsd: number; calls: number; href?: string };

/** Null when the viewer lacks a report scope or the AI-costs permission. */
export async function getAiSpendReport(user: AuthenticatedUser, filters: ReportFilters, page = 1) {
  if (!hasPermission(user, "view_ai_costs")) return null;
  const scopeWhere = usageScopeWhere(user);
  if (!scopeWhere) return null;

  const dateRange = resolveValidatedDateRange(filters);
  const where: Prisma.AiUsageRecordWhereInput = {
    AND: [scopeWhere, { createdAt: { gte: dateRange.start, lt: dateRange.end } }, filters.assignedToId ? { userId: filters.assignedToId } : {}],
  };
  const currentPage = Math.max(1, page);

  const [totals, byOperation, byUser, byModel, bySearch, timeline, calls] = await Promise.all([
    prisma.aiUsageRecord.aggregate({
      where,
      _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: true,
    }),
    prisma.aiUsageRecord.groupBy({ by: ["operation"], where, _sum: { estimatedCostUsd: true }, _count: true }),
    prisma.aiUsageRecord.groupBy({ by: ["userId"], where, _sum: { estimatedCostUsd: true }, _count: true }),
    prisma.aiUsageRecord.groupBy({ by: ["model"], where, _sum: { estimatedCostUsd: true }, _count: true }),
    prisma.aiUsageRecord.groupBy({
      by: ["searchId"],
      where: { AND: [where, { searchId: { not: null } }] },
      _sum: { estimatedCostUsd: true },
      _count: true,
      orderBy: { _sum: { estimatedCostUsd: "desc" } },
      take: 10,
    }),
    prisma.aiUsageRecord.findMany({ where, select: { createdAt: true, estimatedCostUsd: true } }),
    prisma.aiUsageRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * AI_SPEND_CALLS_PAGE_SIZE,
      take: AI_SPEND_CALLS_PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        operation: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        estimatedCostUsd: true,
        searchId: true,
        user: { select: { name: true, initials: true } },
      },
    }),
  ]);

  const userIds = byUser.map((g) => g.userId).filter((id): id is string => id !== null);
  const searchIds = bySearch.map((g) => g.searchId).filter((id): id is string => id !== null);
  const [users, searches] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.leadSearch.findMany({
      where: { id: { in: searchIds } },
      select: { id: true, mode: true, region: true, country: true, createdAt: true, originCompany: { select: { name: true } } },
    }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const searchById = new Map(searches.map((s) => [s.id, s]));

  const sortByCost = (rows: SpendRow[]) => rows.sort((a, b) => b.costUsd - a.costUsd);
  const cost = (sum: { estimatedCostUsd: Prisma.Decimal | null }) => Number(sum.estimatedCostUsd ?? 0);

  // Per day (or per month for long ranges), in the business timezone, with
  // empty days kept so gaps show as $0.00 rather than disappearing. The
  // empty days are found by stepping from midday, which a daylight-saving
  // hour either way can't push onto the wrong date.
  const daily = (dateRange.end.getTime() - dateRange.start.getTime()) / 86_400_000 <= DAILY_LIMIT_DAYS;
  const bucketKey = (instant: Date) => {
    const { year, month, day } = zonedCalendarDate(instant);
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    return daily ? `${ym}-${String(day).padStart(2, "0")}` : ym;
  };
  const buckets = new Map<string, { costUsd: number; calls: number }>();
  for (let t = dateRange.start.getTime() + 12 * 3_600_000; t < dateRange.end.getTime(); t += 86_400_000) {
    buckets.set(bucketKey(new Date(t)), { costUsd: 0, calls: 0 });
  }
  for (const row of timeline) {
    const key = bucketKey(row.createdAt);
    const bucket = buckets.get(key) ?? { costUsd: 0, calls: 0 };
    bucket.costUsd += Number(row.estimatedCostUsd);
    bucket.calls += 1;
    buckets.set(key, bucket);
  }

  return {
    totalUsd: Number(totals._sum.estimatedCostUsd ?? 0),
    callCount: totals._count,
    inputTokens: totals._sum.inputTokens ?? 0,
    outputTokens: totals._sum.outputTokens ?? 0,
    cacheTokens: (totals._sum.cacheReadTokens ?? 0) + (totals._sum.cacheCreationTokens ?? 0),
    period: daily ? ("day" as const) : ("month" as const),
    timeline: [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([label, b]) => ({ label, costUsd: b.costUsd, calls: b.calls })),
    byOperation: sortByCost(byOperation.map((g) => ({ label: aiOperationLabel(g.operation), costUsd: cost(g._sum), calls: g._count }))),
    byUser: sortByCost(byUser.map((g) => ({ label: g.userId ? (userName.get(g.userId) ?? "Removed user") : "System (no person)", costUsd: cost(g._sum), calls: g._count }))),
    byModel: sortByCost(byModel.map((g) => ({ label: g.model, costUsd: cost(g._sum), calls: g._count }))),
    topSearches: bySearch.map((g) => {
      const search = g.searchId ? searchById.get(g.searchId) : undefined;
      const label = !search
        ? "Deleted search"
        : search.mode === "PUB_RADIUS"
          ? `Near ${search.originCompany?.name ?? "unknown pub"}`
          : `${search.region}, ${search.country}`;
      return { label, costUsd: cost(g._sum), calls: g._count, href: search ? `/leads/searches/${search.id}` : undefined, createdAt: search?.createdAt ?? null };
    }),
    calls: calls.map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      operation: aiOperationLabel(c.operation),
      model: c.model,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      costUsd: Number(c.estimatedCostUsd),
      searchId: c.searchId,
      user: c.user,
    })),
    page: currentPage,
    pageCount: Math.max(1, Math.ceil(totals._count / AI_SPEND_CALLS_PAGE_SIZE)),
  };
}

export type AiSpendReport = NonNullable<Awaited<ReturnType<typeof getAiSpendReport>>>;
