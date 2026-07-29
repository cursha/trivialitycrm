import { z } from "zod";
import { titleCaseCity } from "../text-case";
import { RegionCodeSchema } from "./region";

const CitiesSchema = z
  .array(z.string().trim().min(1).transform(titleCaseCity))
  .max(50)
  .default([]);

export const CountryValues = ["Canada", "United States"] as const;
export const LeadSearchModeValues = ["TRIVIA_GAP", "TRIVIA_CONFIRMED", "COMPETITOR", "GENERAL"] as const;

export const SearchSetupSchema = z
  .object({
    promptId: z.string().min(1, { error: "Choose a research prompt." }),
    country: z.enum(CountryValues, { error: "Choose Canada or United States." }),
    region: RegionCodeSchema,
    cities: CitiesSchema,
    leadTypeId: z.string().min(1, { error: "Choose a Lead Type." }),
    minimumScore: z.coerce.number().int().min(0).max(100).default(80),
    mode: z.enum(LeadSearchModeValues, { error: "Choose a research mode." }),
    competitorId: z
      .string()
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .refine((data) => data.mode !== "COMPETITOR" || !!data.competitorId, {
    error: "Choose a competitor for a competitor-research search.",
    path: ["competitorId"],
  });

export type SearchSetupValues = z.infer<typeof SearchSetupSchema>;

// Quick Search: no prompt, no mode/score choice — always a GENERAL-mode,
// directory-only listing (see startQuickSearch). One or more Lead Types can
// be checked at once; each becomes its own LeadSearch since a LeadSearch (and
// the Company a result later transfers into) is always tied to exactly one
// Lead Type.
export const QuickSearchSetupSchema = z.object({
  leadTypeIds: z.array(z.string().min(1)).min(1, { error: "Choose at least one Lead Type." }),
  country: z.enum(CountryValues, { error: "Choose Canada or United States." }),
  region: RegionCodeSchema,
  cities: CitiesSchema,
});

export type QuickSearchSetupValues = z.infer<typeof QuickSearchSetupSchema>;
