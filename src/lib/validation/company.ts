import { z } from "zod";

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
  city: z.string().trim().min(1, { error: "Enter a city." }).max(120),
  region: z.string().trim().min(1, { error: "Enter a state/province." }).max(120),
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
  assignedToId: z.string().min(1, { error: "Choose an assigned salesperson." }),
  triviaStatus: z.enum(TriviaStatusValues),
  notes: optionalText(5000),
  nextFollowUpAt: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
});

export type CompanyFormValues = z.infer<typeof CompanySchema>;
