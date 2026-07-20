import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const TerritorySchema = z
  .object({
    name: optionalText(120),
    country: z.string().trim().min(1, { error: "Enter a country." }).max(120),
    region: optionalText(120),
    city: optionalText(120),
    assignedToId: optionalText(100),
  })
  // Mirrors the specificity hierarchy territory-match.ts relies on: a
  // city-level scope only makes sense once the region is also fixed.
  .refine((data) => !(data.city && !data.region), {
    error: "A city-level territory needs a state/province too.",
    path: ["city"],
  });

export type TerritoryFormValues = z.infer<typeof TerritorySchema>;
