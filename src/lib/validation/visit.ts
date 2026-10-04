import { z } from "zod";

export const WeekdayValues = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

const optionalId = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/** A rough headcount typed at the door — whole people, sanity-capped. */
const optionalHeadcount = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5000) {
      ctx.addIssue({ code: "custom", message: "Enter the slow-night headcount as a whole number (0–5000)." });
      return z.NEVER;
    }
    return parsed;
  });

const optionalWeekday = z
  .union([z.enum(WeekdayValues), z.literal("")])
  .optional()
  .transform((value) => (value ? value : undefined));

/** The bar-intel fields, shared by the visit form and the company page's
 * Bar intel card. */
export const BarIntelSchema = z.object({
  slowNight: optionalWeekday,
  slowNightHeadcount: optionalHeadcount,
  currentEntertainment: optionalText(200),
  triviaHistory: optionalText(2000),
});

export const VisitSchema = BarIntelSchema.extend({
  outcomeId: z.string().min(1, { error: "Choose what happened on this visit." }),
  notes: optionalText(5000),
  rejectionReasonId: optionalId,
  /** IANA zone the form's wall-clock times are in (the rep's browser zone). */
  timezone: z.string().trim().min(1, { error: "Missing timezone." }),
  occurredAt: optionalText(32),
  demoStartAt: optionalText(32),
  demoDurationMinutes: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return 20;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 5 || parsed > 240) {
        ctx.addIssue({ code: "custom", message: "Enter a demo length between 5 and 240 minutes." });
        return z.NEVER;
      }
      return parsed;
    }),
  demoContactId: optionalId,
  sendInvite: z
    .string()
    .optional()
    .transform((value) => value === "on"),
});

export type VisitInput = z.infer<typeof VisitSchema>;
