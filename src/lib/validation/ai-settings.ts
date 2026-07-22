import { z } from "zod";
import { APPROVED_MODEL_OPTIONS } from "../ai/models";

const optionalPositiveInt = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((value) => (value ? Number(value) : undefined))
  .refine((value) => value === undefined || (Number.isInteger(value) && value > 0), { error: "Must be a positive whole number." });

const optionalPositiveMoney = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((value) => (value ? Number(value) : undefined))
  .refine((value) => value === undefined || value > 0, { error: "Must be a positive amount." });

export const AiSettingsSchema = z.object({
  researchEnabled: z.coerce.boolean(),
  approvedModel: z.enum(APPROVED_MODEL_OPTIONS, { error: "Choose a supported model." }),
  defaultMinimumScore: z.coerce.number().int().min(0).max(100),
  maxCitiesPerSearch: z.coerce.number().int().min(1).max(50, { error: "Cannot exceed the app's own 50-city limit per search." }),
  maxResultsPerSearch: optionalPositiveInt,
  dailyBudgetUsd: optionalPositiveMoney,
  monthlyBudgetUsd: optionalPositiveMoney,
  warningThresholdUsd: optionalPositiveMoney,
  perUserDailySearchLimit: optionalPositiveInt,
});

export type AiSettingsValues = z.infer<typeof AiSettingsSchema>;
