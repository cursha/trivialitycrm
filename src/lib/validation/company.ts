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

export const TriviaStatusValues = ["CURRENT_TRIVIA", "NO_CURRENT_TRIVIA", "UNCERTAIN"] as const;

export const CompanySchema = z.object({
  name: z.string().trim().min(1, { error: "Enter a company name." }).max(200),
  address1: optionalText(200),
  city: z.string().trim().min(1, { error: "Enter a city." }).max(120).transform(titleCaseCity),
  region: RegionCodeSchema,
  postalCode: optionalText(20),
  country: z.string().trim().min(1, { error: "Enter a country." }).max(120),
  phone: optionalText(40),
  email: z
    .union([z.email({ error: "Enter a valid email." }), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  websiteUrl: z
    .union([z.url({ error: "Enter a valid URL." }), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  leadTypeId: z.string().min(1, { error: "Choose a lead type." }),
  pipelineStageId: z.string().min(1, { error: "Choose a pipeline stage." }),
  competitorId: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  // Optional — a company can be created or left unassigned; Module Four's
  // "Unassigned Leads" view relies on this.
  assignedToId: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  triviaStatus: z.enum(TriviaStatusValues),
  // Only meaningful when pipelineStageId resolves to a Lost-outcome stage —
  // enforced server-side in the caller, not here, since this schema has no
  // access to PipelineStage.outcomeType.
  lossReasonId: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined)),
  notes: optionalText(5000),
  nextFollowUpAt: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});

export type CompanyFormValues = z.infer<typeof CompanySchema>;
