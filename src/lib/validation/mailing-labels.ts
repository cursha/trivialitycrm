import { z } from "zod";
import { SecondaryTag } from "../../generated/prisma/enums";
import { LIMITS, MAX_OFFSET_MM } from "../mailing-labels/geometry";

const shortText = z.string().trim().min(1).max(100);

/**
 * Mailing-label filters. Categories combine with AND; several values within
 * one category combine with OR. Tags match any selected tag unless
 * tagMode is "all". An empty category means no restriction.
 */
export const LabelFiltersSchema = z.object({
  /** A city is matched together with its province/state (two Springfields). */
  cities: z.array(z.object({ city: shortText, region: shortText })).max(200).default([]),
  /** A province/state is matched together with its country. */
  regions: z.array(z.object({ region: shortText, country: shortText })).max(100).default([]),
  stageIds: z.array(z.string().min(1).max(40)).max(100).default([]),
  salespersonIds: z.array(z.string().min(1).max(40)).max(200).default([]),
  tags: z.array(z.enum(Object.values(SecondaryTag) as [SecondaryTag, ...SecondaryTag[]])).max(10).default([]),
  tagMode: z.enum(["any", "all"]).default("any"),
  /** Companies ticked on the Companies list ("Print labels for N selected"). */
  companyIds: z.array(z.string().min(1).max(40)).max(5000).default([]),
});
export type LabelFilters = z.infer<typeof LabelFiltersSchema>;

export const EMPTY_FILTERS: LabelFilters = { cities: [], regions: [], stageIds: [], salespersonIds: [], tags: [], tagMode: "any", companyIds: [] };

export function filtersAreEmpty(f: LabelFilters): boolean {
  return f.cities.length === 0 && f.regions.length === 0 && f.stageIds.length === 0 && f.salespersonIds.length === 0 && f.tags.length === 0 && f.companyIds.length === 0;
}

/** A stored draft's filters, falling back to none if they no longer parse. */
export function parseStoredFilters(value: unknown): LabelFilters {
  const parsed = LabelFiltersSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_FILTERS;
}

/** { companyId: contactId | "MANAGER" } */
export function parseStoredOverrides(value: unknown): Record<string, string> {
  const parsed = z.record(z.string(), z.string()).safeParse(value);
  return parsed.success ? parsed.data : {};
}

const mm = (label: string) => z.coerce.number({ error: `${label} must be a number.` }).finite({ error: `${label} must be a number.` });

/** A sheet's name plus measurements in millimetres (the form converts inches). */
export const LabelSheetSchema = z.object({
  name: z.string().trim().min(1, { error: "Give the sheet a name." }).max(80, { error: "Keep the name to 80 characters or fewer." }),
  productCode: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => value || undefined),
  pageWidthMm: mm("Page width"),
  pageHeightMm: mm("Page height"),
  rows: z.coerce.number().int({ error: "Rows must be a whole number." }),
  columns: z.coerce.number().int({ error: "Columns must be a whole number." }),
  labelWidthMm: mm("Label width"),
  labelHeightMm: mm("Label height"),
  topMm: mm("Top margin"),
  leftMm: mm("Left margin"),
  gapXMm: mm("Horizontal gap"),
  gapYMm: mm("Vertical gap"),
  paddingMm: mm("Inner padding"),
  preferredFontPt: mm("Preferred font size"),
  minFontPt: mm("Minimum font size"),
  lineHeight: z.coerce.number().min(LIMITS.minLineHeight).max(LIMITS.maxLineHeight),
  measurementNote: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || undefined),
});
export type LabelSheetInput = z.infer<typeof LabelSheetSchema>;

export const AlignmentProfileSchema = z.object({
  name: z.string().trim().min(1, { error: "Give the printer setting a name." }).max(60),
  templateId: z.string().min(1),
  offsetXMm: z.coerce.number().finite().min(-MAX_OFFSET_MM, { error: `Keep the correction within ${MAX_OFFSET_MM} mm.` }).max(MAX_OFFSET_MM, { error: `Keep the correction within ${MAX_OFFSET_MM} mm.` }),
  offsetYMm: z.coerce.number().finite().min(-MAX_OFFSET_MM, { error: `Keep the correction within ${MAX_OFFSET_MM} mm.` }).max(MAX_OFFSET_MM, { error: `Keep the correction within ${MAX_OFFSET_MM} mm.` }),
});

export const MailingLabelSettingsSchema = z.object({
  maxLabelsPerBatch: z.coerce.number().int().min(1, { error: "Allow at least 1 label." }).max(5000, { error: "The most labels in one job is 5,000." }),
  retentionDays: z.coerce.number().int().min(7, { error: "Keep batches for at least 7 days." }).max(3650, { error: "The longest is 3,650 days (10 years)." }),
});
