import { z } from "zod";

export const CompetitionLocatorRegionSchema = z.object({
  country: z.enum(["Canada", "United States"]),
  code: z
    .string()
    .trim()
    .length(2, { error: "Region code must be 2 letters." })
    .transform((value) => value.toUpperCase()),
});

export type CompetitionLocatorRegion = z.infer<typeof CompetitionLocatorRegionSchema>;

// regions defaults to [] — a blank selection means "search broadly across
// Canada + United States" (expanded to every region in
// north-american-regions.ts by startCompetitionLocatorRun), not an error.
export const CompetitionLocatorStartSchema = z.object({
  competitorId: z.string().min(1, { error: "Choose a competitor." }),
  leadTypeId: z.string().min(1, { error: "Choose a Lead Type." }),
  regions: z.array(CompetitionLocatorRegionSchema).default([]),
});

export type CompetitionLocatorStartValues = z.infer<typeof CompetitionLocatorStartSchema>;
