import { z } from "zod";

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
  city: z.string().trim().min(1, { error: "Enter a city." }).max(120),
  region: z.string().trim().min(1, { error: "Enter a state/province." }).max(120),
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
  overrideDuplicate: z.boolean().default(false),
});

export const TransferPayloadSchema = z.object({
  assignedToId: z.string().min(1, { error: "Choose a salesperson to assign these leads to." }),
  pipelineStageId: z.string().min(1, { error: "Choose an initial pipeline stage." }),
  rows: z.array(TransferRowSchema).min(1, { error: "Select at least one result to transfer." }),
});

export type TransferPayload = z.infer<typeof TransferPayloadSchema>;
export type TransferRow = z.infer<typeof TransferRowSchema>;
