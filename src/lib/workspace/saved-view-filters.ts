import { z } from "zod";
import { TriviaStatusValues } from "@/lib/validation/company";
import { OpportunityGrade, ConfidenceLevel, PrimaryClassification, CompanyStatus } from "@/generated/prisma/enums";
import { SORTABLE_FIELDS_LIST } from "@/app/(dashboard)/companies/queries";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use YYYY-MM-DD." });

/**
 * Validated shape of SavedView.filters — a plain data object mirroring
 * CompanyListParams plus the Module Four dimensions (territory, cities,
 * score range, days-since-activity, created-date range, status). `.strict()`
 * rejects any unknown key, and every field is a scalar/enum/array of
 * scalars — there is no way to smuggle executable code or raw query text
 * through this shape. Applied on every save AND every load-and-apply, so a
 * row written before a schema tightening still fails safe on read.
 */
export const SavedViewFiltersSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    leadTypeId: z.string().max(100).optional(),
    pipelineStageId: z.string().max(100).optional(),
    assignedToId: z.string().max(100).optional(),
    territoryId: z.string().max(100).optional(),
    competitorId: z.string().max(100).optional(),
    country: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    cities: z.array(z.string().trim().max(120)).max(50).optional(),
    triviaStatus: z.enum(TriviaStatusValues).optional(),
    opportunityGrade: z.enum(Object.values(OpportunityGrade) as [string, ...string[]]).optional(),
    confidenceLevel: z.enum(Object.values(ConfidenceLevel) as [string, ...string[]]).optional(),
    primaryClassification: z.enum(Object.values(PrimaryClassification) as [string, ...string[]]).optional(),
    scoreMin: z.number().int().min(0).max(100).optional(),
    scoreMax: z.number().int().min(0).max(100).optional(),
    followUp: z.enum(["overdue", "today", "upcoming", "none"]).optional(),
    daysSinceActivityMin: z.number().int().min(0).max(3650).optional(),
    daysSinceActivityMax: z.number().int().min(0).max(3650).optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    status: z.enum(Object.values(CompanyStatus) as [string, ...string[]]).optional(),
    sortBy: z.enum(SORTABLE_FIELDS_LIST).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

export type SavedViewFilters = z.infer<typeof SavedViewFiltersSchema>;

/** Load-time guard — a row written before a schema change should never be
 * trusted blindly. Returns an empty filter set (never throws) so a stale
 * saved view degrades to "no filters" instead of breaking the page. */
export function parseSavedViewFilters(value: unknown): SavedViewFilters {
  const result = SavedViewFiltersSchema.safeParse(value);
  return result.success ? result.data : {};
}
