import { z } from "zod";
import { titleCaseCity } from "@/lib/text-case";
import { RegionCodeSchema } from "@/lib/validation/region";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const TransferRowSchema = z.object({
  resultId: z.string().min(1),
  name: z.string().trim().min(1, { error: "Enter a company name." }).max(200),
  address1: optionalText(200),
  city: z
    .string()
    .trim()
    .min(1, { error: "Enter a city." })
    .max(120)
    .transform(titleCaseCity),
  region: RegionCodeSchema,
  postalCode: optionalText(20),
  country: z.string().trim().min(1, { error: "Enter a country." }).max(120),
  phone: optionalText(40),
  email: z
    .union([z.email(), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  websiteUrl: z
    .union([z.url(), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  contactFirstName: optionalText(100),
  contactLastName: optionalText(100),
  contactPhone: optionalText(40),
  contactEmail: z
    .union([z.email(), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  contactTitle: optionalText(100),
  contactNote: optionalText(2000),
  // Administrator-only resolution for a detected duplicate (see
  // findPotentialDuplicates()). Undefined means "not decided yet" — the
  // action first returns the duplicate list so the UI can ask; the retry
  // submission carries the user's choice back here.
  // - "replace": overwrite the existing company's core fields with this
  //   row's fresh data.
  // - "merge": only fill fields the existing company doesn't already have
  //   — never overwrites data already on file.
  // - "ignore": skip this row for this transfer; nothing is created or
  //   changed, the SearchResult's disposition is left as-is.
  duplicateAction: z.enum(["replace", "merge", "ignore"]).optional(),
  // Which matched company to act on, when findPotentialDuplicates() returns
  // more than one candidate for this row. Required (checked at the action
  // layer, not here) whenever duplicateAction is "replace" or "merge" and
  // there was more than one match.
  duplicateTargetCompanyId: z.string().optional(),
});

export const TransferPayloadSchema = z.object({
  assignedToId: z.string().min(1, { error: "Choose a salesperson to assign these leads to." }),
  pipelineStageId: z.string().min(1, { error: "Choose an initial pipeline stage." }),
  rows: z.array(TransferRowSchema).min(1, { error: "Select at least one result to transfer." }),
});

export type TransferPayload = z.infer<typeof TransferPayloadSchema>;
export type TransferRow = z.infer<typeof TransferRowSchema>;
