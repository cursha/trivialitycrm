import { z } from "zod";

const REGION_ERROR = "Enter a 2-letter state/province code (e.g. ON, CO) — not the full name.";

/** Required state/province field: must be exactly a 2-letter code, uppercased on write. */
export const RegionCodeSchema = z
  .string()
  .trim()
  .length(2, { error: REGION_ERROR })
  .transform((value) => value.toUpperCase());

/** Optional state/province field (e.g. Territory scope): a 2-letter code, or absent — never
 * a full name/garbage value in between. */
export const OptionalRegionCodeSchema = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((value) => (value ? value : undefined))
  .refine((value) => value === undefined || value.length === 2, { error: REGION_ERROR })
  .transform((value) => value?.toUpperCase());
