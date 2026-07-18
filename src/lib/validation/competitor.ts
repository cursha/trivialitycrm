import { z } from "zod";

export const CompetitorSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter a name." }).max(120),
  websiteUrl: z.union([z.url({ error: "Enter a valid URL." }), z.literal("")]).optional(),
});
