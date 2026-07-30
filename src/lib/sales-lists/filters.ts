import { z } from "zod";
import { TriviaStatusValues } from "@/lib/validation/company";
import { OpportunityGrade, ConfidenceLevel, PrimaryClassification, CompanyStatus } from "@/generated/prisma/enums";
import { SORTABLE_FIELDS_LIST, type CompanyListParams } from "@/app/(dashboard)/companies/queries";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use YYYY-MM-DD." });

/**
 * Validated shape of SalesList.filters — the List Builder's full filter set
 * (spec: country/province/city/lead type/pipeline stage/owner/EOS range/
 * confidence/classification/competitor/trivia status/last contacted/never
 * contacted/primary contact & phone & email availability/overdue follow-up/
 * missing next action/active-archived/existing customer/do-not-contact/last
 * analyzed date/data-quality warnings). Deliberately mirrors
 * SavedViewFiltersSchema's field names where they overlap (src/lib/
 * workspace/saved-view-filters.ts) for consistency, rather than inventing
 * parallel names for the same concepts — both ultimately feed the same
 * buildCompanyWhere() (src/app/(dashboard)/companies/queries.ts). `.strict()`
 * rejects any unknown key; every field is a scalar/enum/array of scalars —
 * never raw query text. Applied on every save AND every dynamic-list
 * re-evaluation, so a row written before a schema tightening still fails
 * safe on read (see parseSalesListFilters below).
 */
export const SalesListFiltersSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    leadTypeId: z.string().max(100).optional(),
    pipelineStageId: z.string().max(100).optional(),
    assignedToId: z.string().max(100).optional(),
    unassignedOnly: z.boolean().optional(),
    competitorId: z.string().max(100).optional(),
    country: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    cities: z.array(z.string().trim().max(120)).max(50).optional(),
    triviaStatus: z.enum(TriviaStatusValues).optional(),
    opportunityGrade: z.enum(Object.values(OpportunityGrade) as [string, ...string[]]).optional(),
    confidenceLevel: z.enum(Object.values(ConfidenceLevel) as [string, ...string[]]).optional(),
    primaryClassification: z.enum(Object.values(PrimaryClassification) as [string, ...string[]]).optional(),
    scoreMin: z.number().int().min(0).max(100).optional(),
    scoreMax: z.number().int().min(0).max(100).optional(),
    followUp: z.enum(["overdue", "today", "upcoming", "none"]).optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    neverContactedOnly: z.boolean().optional(),
    lastContactedBefore: isoDate.optional(),
    hasPhone: z.boolean().optional(),
    hasEmail: z.boolean().optional(),
    isExistingCustomer: z.boolean().optional(),
    doNotContactOnly: z.boolean().optional(),
    neverAnalyzedOnly: z.boolean().optional(),
    lastAnalyzedBefore: isoDate.optional(),
    hasDataQualityWarnings: z.boolean().optional(),
    status: z.enum(Object.values(CompanyStatus) as [string, ...string[]]).optional(),
    sortBy: z.enum(SORTABLE_FIELDS_LIST).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

export type SalesListFilters = z.infer<typeof SalesListFiltersSchema>;

/** Load-time guard — a row written before a schema change should never be
 * trusted blindly. Returns an empty filter set (never throws) so a stale
 * dynamic list degrades to "no filters" instead of breaking the page,
 * matching parseSavedViewFilters's exact precedent. */
export function parseSalesListFilters(value: unknown): SalesListFilters {
  const result = SalesListFiltersSchema.safeParse(value);
  return result.success ? result.data : {};
}

/** The one place SalesListFilters becomes a real query — every dynamic-list
 * re-evaluation (List Builder preview, List page refresh, calling-session
 * snapshot, campaign recipient resolution) must go through this rather than
 * hand-rolling its own CompanyListParams, so all four stay consistent. */
export function toCompanyListParams(filters: SalesListFilters): CompanyListParams {
  return {
    ...filters,
    status: (filters.status as CompanyListParams["status"]) ?? "ACTIVE",
  };
}
