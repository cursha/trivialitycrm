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
  occurredAt: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
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
  // Optional follow-up scheduled with the activity: a date (YYYY-MM-DD, as
  // the follow-up form takes) creates a Task linked to the activity.
  followUpAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Choose a valid follow-up date." })
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  followUpTitle: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});
