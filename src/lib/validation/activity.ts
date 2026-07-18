import { z } from "zod";

export const ActivityTypeValues = [
  "PHONE",
  "EMAIL",
  "MEETING",
  "MATERIAL_SENT",
  "DEMO",
  "TRIAL",
  "NOTE",
] as const;

export const ActivitySchema = z.object({
  type: z.enum(ActivityTypeValues, { error: "Choose an activity type." }),
  notes: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  outcome: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});
