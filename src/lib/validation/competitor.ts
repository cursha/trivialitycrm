import { z } from "zod";

export const CompetitorSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter a name." }).max(120),
  websiteUrl: z.union([z.url({ error: "Enter a valid URL." }), z.literal("")]).optional(),
  locationCount: z.coerce.number().int().min(0, { error: "Cannot be negative." }).default(0),
});
