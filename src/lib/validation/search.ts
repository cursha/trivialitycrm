import { z } from "zod";

export const CountryValues = ["Canada", "United States"] as const;
export const LeadSearchModeValues = ["TRIVIA_GAP", "TRIVIA_CONFIRMED", "COMPETITOR", "GENERAL"] as const;

export const SearchSetupSchema = z
  .object({
    promptId: z.string().min(1, { error: "Choose a research prompt." }),
    country: z.enum(CountryValues, { error: "Choose Canada or United States." }),
    region: z.string().trim().min(1, { error: "Enter a state or province." }).max(120),
    cities: z.array(z.string().trim().min(1)).max(50).default([]),
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
