import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { TriviaStatusValues } from "@/lib/validation/company";
import { LeadSource, CompanyStatus } from "@/generated/prisma/enums";
import { REPORT_DATE_RANGE_KEYS, resolveReportDateRange, zonedDayRange, type DateRange } from "@/lib/timezone";
import type { Prisma } from "../../generated/prisma/client";
import { territoryWhereClause } from "@/lib/workspace/territory-match";
import type { ReportScope } from "./scope";
import { reportCompanyWhere } from "./scope";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use YYYY-MM-DD." });

/**
 * Validated shape of every /reports/* filter bar — deliberately a separate
 * schema from SavedViewFiltersSchema (company-list filtering) rather than
 * an extension of it: report filters carry fields (dateRange, outcome) that
 * make no sense on a company list, and the two are read by very different
 * query code. Both are still stored through the same SavedView.filters Json
 * column — no duplicate storage system, per the brief's "do not create a
 * duplicate saved-report system unless necessary." `.strict()` for the same
 * reason as SavedViewFiltersSchema: no unknown key, no way to smuggle raw
 * query text through this shape.
 */
export const ReportFiltersSchema = z
  .object({
    dateRange: z.enum(REPORT_DATE_RANGE_KEYS).default("month"),
    customFrom: isoDate.optional(),
    customTo: isoDate.optional(),
    territoryId: z.string().max(100).optional(),
    leadTypeId: z.string().max(100).optional(),
    pipelineStageId: z.string().max(100).optional(),
    assignedToId: z.string().max(100).optional(),
    source: z.enum(Object.values(LeadSource) as [string, ...string[]]).optional(),
    competitorId: z.string().max(100).optional(),
    scoreMin: z.number().int().min(0).max(100).optional(),
    scoreMax: z.number().int().min(0).max(100).optional(),
    triviaStatus: z.enum(TriviaStatusValues).optional(),
    status: z.enum(Object.values(CompanyStatus) as [string, ...string[]]).optional(),
    outcome: z.enum(["WON", "LOST"]).optional(),
    country: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
  })
  .strict();

export type ReportFilters = z.infer<typeof ReportFiltersSchema>;

/** Load/query-string-time guard, same fail-safe-to-empty behavior as
 * parseSavedViewFilters — a malformed filter set degrades to "no filters
 * beyond scope," never a thrown error the user can't recover from. */
export function parseReportFilters(value: unknown): ReportFilters {
  const result = ReportFiltersSchema.safeParse(value);
  return result.success ? result.data : { dateRange: "month" };
}

/** Resolves a validated filter set's date range, falling back to "this
 * month" if a tampered/malformed custom range slips through (missing
 * bound, or end <= start) — a bad URL param degrades to a sane default
 * instead of a thrown 500. */
export function resolveValidatedDateRange(filters: ReportFilters, reference: Date = new Date()): DateRange {
  if (filters.dateRange !== "custom") {
    return resolveReportDateRange(filters.dateRange, undefined, reference);
  }
  if (filters.customFrom && filters.customTo) {
    // Noon UTC on each calendar date safely lands within that date in every
    // real-world timezone (no DST edge lands a noon-UTC instant on the
    // adjacent calendar day), so zonedDayRange resolves each bound to the
    // correct business-timezone day boundary.
    const start = zonedDayRange(new Date(`${filters.customFrom}T12:00:00.000Z`)).start;
    const end = zonedDayRange(new Date(`${filters.customTo}T12:00:00.000Z`)).end;
    if (end.getTime() > start.getTime()) {
      return { start, end };
    }
  }
  return resolveReportDateRange("month", undefined, reference);
}

/**
 * Turns validated filters + the viewer's report scope into one
 * Prisma.CompanyWhereInput. Does NOT apply the date-range filter — which
 * date field a range applies to (createdAt, stage-change date, activity
 * date...) differs per report, so callers combine this with their own date
 * clause on the field that's actually meaningful for that report.
 * `territory` must be pre-fetched by the caller (territoryWhereClause needs
 * the full row, not just an id) — kept out of this function so it stays
 * synchronous and independently testable.
 */
export function reportFiltersToCompanyWhere(
  filters: ReportFilters,
  scope: ReportScope,
  territory?: { country: string; region: string | null; city: string | null } | null,
): Prisma.CompanyWhereInput {
  const clauses: Prisma.CompanyWhereInput[] = [reportCompanyWhere(scope)];

  if (filters.leadTypeId) clauses.push({ leadTypeId: filters.leadTypeId });
  if (filters.pipelineStageId) clauses.push({ pipelineStageId: filters.pipelineStageId });
  if (filters.assignedToId) clauses.push({ assignedToId: filters.assignedToId });
  if (filters.source) clauses.push({ source: filters.source as Prisma.CompanyWhereInput["source"] });
  if (filters.competitorId) clauses.push({ competitorId: filters.competitorId });
  if (filters.triviaStatus) clauses.push({ triviaStatus: filters.triviaStatus });
  if (filters.status) clauses.push({ status: filters.status as Prisma.CompanyWhereInput["status"] });
  if (filters.country) clauses.push({ country: { equals: filters.country, mode: "insensitive" } });
  if (filters.region) clauses.push({ region: { equals: filters.region, mode: "insensitive" } });
  if (filters.city) clauses.push({ city: { equals: filters.city, mode: "insensitive" } });
  if (filters.outcome) clauses.push({ pipelineStage: { outcomeType: filters.outcome } });
  if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
    clauses.push({
      eosScore: {
        ...(filters.scoreMin !== undefined ? { gte: filters.scoreMin } : {}),
        ...(filters.scoreMax !== undefined ? { lte: filters.scoreMax } : {}),
      },
    });
  }
  if (filters.territoryId && territory) {
    clauses.push(territoryWhereClause(territory));
  }

  return { AND: clauses };
}

/**
 * Async convenience wrapper for the common case: resolve the date range,
 * fetch the territory row if a territoryId filter is set, and build the
 * combined company WHERE clause — the one call every report query needs at
 * the top, instead of repeating the territory-fetch boilerplate nine times.
 */
export async function resolveReportFilters(filters: ReportFilters, scope: ReportScope) {
  const dateRange = resolveValidatedDateRange(filters);
  const territory = filters.territoryId ? await prisma.territory.findUnique({ where: { id: filters.territoryId } }) : null;
  const companyWhere = reportFiltersToCompanyWhere(filters, scope, territory);
  return { dateRange, companyWhere };
}
