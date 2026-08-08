import { z } from "zod";
import { MERGEABLE_TRANSFER_FIELDS } from "../companies/field-resolution";

// Trimmed fork of competition-locator-review.ts's save schema: runId ->
// searchId (PUB_RADIUS is always a single LeadSearch, no runCorrelationId
// fan-out), competitorConflictResolution dropped entirely — there is no
// competitor concept in this mode, so that bucket never populates and this
// field would never mean anything.
const FieldDecisionSchema = z.union([
  z.object({ mode: z.literal("keepExisting") }),
  z.object({ mode: z.literal("useNew") }),
  z.object({ mode: z.literal("override"), value: z.string() }),
]);

const ContactDataEntrySchema = z.object({
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  title: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export const PubRadiusDuplicateResolutionValues = ["create", "merge", "ignore"] as const;

export const PubRadiusRowDecisionSchema = z.object({
  resultId: z.string().min(1),
  approved: z.boolean(),
  fieldDecisions: z.partialRecord(z.enum(MERGEABLE_TRANSFER_FIELDS), FieldDecisionSchema).default({}),
  contacts: z.array(ContactDataEntrySchema).default([]),
  duplicateResolution: z.enum(PubRadiusDuplicateResolutionValues).optional(),
});

export type PubRadiusRowDecision = z.infer<typeof PubRadiusRowDecisionSchema>;

export const PubRadiusSaveSchema = z.object({
  searchId: z.string().min(1),
  assignedToId: z.string().min(1, { error: "Choose a salesperson to assign new companies to." }),
  pipelineStageId: z.string().min(1, { error: "Choose an initial pipeline stage for new companies." }),
  rows: z.array(PubRadiusRowDecisionSchema).min(1, { error: "Select at least one result to save." }),
});

export type PubRadiusSavePayload = z.infer<typeof PubRadiusSaveSchema>;
