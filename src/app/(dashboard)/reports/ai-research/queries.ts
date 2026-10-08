// No `import "server-only"` — the worker (via src/lib/reports/build-rows.ts)
// needs this module too; see src/lib/prisma.ts for the same reasoning.
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportScope, reportUserWhere } from "@/lib/reports/scope";
import { resolveValidatedDateRange, type ReportFilters } from "@/lib/reports/filters";
import { hasPermission } from "@/lib/auth/permissions";

const DISPOSITION_LABELS: Record<string, string> = {
  NEW: "New (not yet reviewed)",
  REVIEWED: "Reviewed",
  TRANSFERRED: "Transferred to CRM",
  REJECTED: "Rejected",
  BELOW_SCORE: "Below minimum score",
  DUPLICATE: "Duplicate",
};

/**
 * A LeadSearch doesn't always produce a Company, so most of ReportFilters
 * (territory, pipeline stage, salesperson-as-assignee, source, score,
 * status, outcome) has no meaningful analogue here. Only the two filters
 * that exist directly on LeadSearch — lead type and competitor — are
 * applied; this is a deliberate, documented scope trim, not an oversight.
 */
export async function getAiResearchReport(user: AuthenticatedUser, filters: ReportFilters) {
  const scope = reportScope(user);
  if (!scope) return null;

  const dateRange = resolveValidatedDateRange(filters);
  const searchWhere = {
    AND: [
      { createdBy: reportUserWhere(scope) },
      { createdAt: { gte: dateRange.start, lt: dateRange.end } },
      filters.leadTypeId ? { leadTypeId: filters.leadTypeId } : {},
      filters.competitorId ? { competitorId: filters.competitorId } : {},
    ],
  };

  const [searchesRun, searchesByStatus, candidatesDiscovered, candidatesScored, resultsByDisposition] = await Promise.all([
    prisma.leadSearch.count({ where: searchWhere }),
    prisma.leadSearch.groupBy({ by: ["status"], where: searchWhere, _count: true }),
    prisma.searchCandidate.count({ where: { search: searchWhere } }),
    prisma.searchCandidate.count({ where: { search: searchWhere, score: { not: null } } }),
    prisma.searchResult.groupBy({ by: ["disposition"], where: { search: searchWhere }, _count: true }),
  ]);

  const funnel = [
    { label: "Candidates discovered", count: candidatesDiscovered },
    { label: "Candidates scored", count: candidatesScored },
  ];
  const dispositionBreakdown = resultsByDisposition.map((g) => ({
    label: DISPOSITION_LABELS[g.disposition] ?? g.disposition,
    count: g._count,
  }));
  const searchStatusBreakdown = searchesByStatus.map((g) => ({ label: g.status, count: g._count }));

  let costEstimate: { totalUsd: number; totalTokens: number; callCount: number } | null = null;
  if (hasPermission(user, "view_ai_costs")) {
    const usage = await prisma.aiUsageRecord.aggregate({
      where: { search: searchWhere },
      _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    });
    costEstimate = {
      totalUsd: Number(usage._sum.estimatedCostUsd ?? 0),
      totalTokens: (usage._sum.inputTokens ?? 0) + (usage._sum.outputTokens ?? 0),
      callCount: usage._count,
    };
  }

  const emailFinding = await getEmailFindingStats(user, scope, filters, dateRange);

  return { searchesRun, funnel, dispositionBreakdown, searchStatusBreakdown, costEstimate, emailFinding };
}

/**
 * Is "Find emails" paying off? Counted by when each lookup ran (not when
 * its search was created), so a month's figures are that month's lookups.
 * Kept so Curt can stop the paid web search if it isn't finding enough
 * emails for what it costs (his call, 2026-10-08): emails found, how many
 * of those venues went on to be transferred into the CRM, and — with the
 * cost permission — the spend and the cost per email found.
 */
async function getEmailFindingStats(
  user: AuthenticatedUser,
  scope: NonNullable<ReturnType<typeof reportScope>>,
  filters: ReportFilters,
  dateRange: { start: Date; end: Date },
) {
  const searchScope = {
    AND: [{ createdBy: reportUserWhere(scope) }, filters.leadTypeId ? { leadTypeId: filters.leadTypeId } : {}, filters.competitorId ? { competitorId: filters.competitorId } : {}],
  };
  const inRange = { gte: dateRange.start, lt: dateRange.end };

  const [websiteChecked, websiteFound, webSearched, webFound, webFoundTransferred] = await Promise.all([
    prisma.searchResult.count({ where: { search: searchScope, emailLookupAt: inRange } }),
    prisma.searchResult.count({ where: { search: searchScope, emailLookupAt: inRange, emailSource: "WEBSITE" } }),
    prisma.searchResult.count({ where: { search: searchScope, emailWebSearchAt: inRange } }),
    prisma.searchResult.count({ where: { search: searchScope, emailWebSearchAt: inRange, emailSource: "WEB_SEARCH" } }),
    prisma.searchResult.count({ where: { search: searchScope, emailWebSearchAt: inRange, emailSource: "WEB_SEARCH", disposition: "TRANSFERRED" } }),
  ]);

  let webSearchCostUsd: number | null = null;
  if (hasPermission(user, "view_ai_costs")) {
    const usage = await prisma.aiUsageRecord.aggregate({
      where: { operation: "findEmail", createdAt: inRange, search: searchScope },
      _sum: { estimatedCostUsd: true },
    });
    webSearchCostUsd = Number(usage._sum.estimatedCostUsd ?? 0);
  }

  return {
    websiteChecked,
    websiteFound,
    webSearched,
    webFound,
    webFoundTransferred,
    webSearchCostUsd,
    costPerWebEmailUsd: webSearchCostUsd !== null && webFound > 0 ? webSearchCostUsd / webFound : null,
  };
}
