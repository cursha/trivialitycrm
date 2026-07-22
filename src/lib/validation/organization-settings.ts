import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const CURRENCY_VALUES = ["CAD", "USD"] as const;
export const DATE_FORMAT_VALUES = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"] as const;

function isValidTimeZone(value: string): boolean {
  try {
    // Same technique Module Six's appointment timezone field already uses
    // (src/lib/comms/calendar-time.ts) — Intl throws for an unrecognized
    // IANA zone name, a real validation, not a hand-rolled allowlist.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const OrganizationSettingsSchema = z.object({
  organizationName: z.string().trim().min(1, { error: "Enter an organization name." }).max(200),
  defaultCountry: z.string().trim().min(1, { error: "Enter a default country." }).max(120),
  defaultRegion: optionalText(120),
  defaultTimezone: z.string().trim().refine(isValidTimeZone, { error: "Enter a valid IANA time zone (e.g. America/Toronto)." }),
  defaultCurrency: z.enum(CURRENCY_VALUES, { error: "Choose a supported currency." }),
  defaultDateFormat: z.enum(DATE_FORMAT_VALUES, { error: "Choose a supported date format." }),
  defaultPipelineStageId: z.string().optional().transform((value) => (value ? value : undefined)),
  defaultLeadTypeId: z.string().optional().transform((value) => (value ? value : undefined)),
  businessPhone: optionalText(40),
  businessEmail: z
    .union([z.email({ error: "Enter a valid email." }), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  businessWebsite: z
    .union([z.url({ error: "Enter a valid URL." }), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  businessAddress: optionalText(1000),
});

export type OrganizationSettingsValues = z.infer<typeof OrganizationSettingsSchema>;
