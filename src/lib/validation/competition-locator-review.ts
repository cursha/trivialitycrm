import { z } from "zod";
import { MERGEABLE_TRANSFER_FIELDS } from "../companies/field-resolution";

// Same "keep-existing / use-new / enter-different" shape as
// field-resolution.ts's FieldDecision — kept as a separate Zod schema
// (rather than z.custom<FieldDecision>()) so an invalid client payload is
// rejected with a normal Zod issue instead of an opaque runtime cast.
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

export const DuplicateResolutionValues = ["create", "merge", "ignore"] as const;
export const CompetitorConflictResolutionValues = ["assignAnyway", "keepExisting", "skip"] as const;

// One SearchResult row's approve/reject decision from Competition Locator's
// review screen. duplicateResolution only means anything for a row in the
// "existing with new info"/"possible duplicate" bucket; competitorConflictResolution
// only for a row in the "competitor conflict" bucket — both optional/unused
// for a plain "new company" row's approval.
export const CompetitionLocatorRowDecisionSchema = z.object({
  resultId: z.string().min(1),
  approved: z.boolean(),
  fieldDecisions: z.partialRecord(z.enum(MERGEABLE_TRANSFER_FIELDS), FieldDecisionSchema).default({}),
  contacts: z.array(ContactDataEntrySchema).default([]),
  duplicateResolution: z.enum(DuplicateResolutionValues).optional(),
  competitorConflictResolution: z.enum(CompetitorConflictResolutionValues).optional(),
});

export type CompetitionLocatorRowDecision = z.infer<typeof CompetitionLocatorRowDecisionSchema>;

export const CompetitionLocatorSaveSchema = z.object({
  runId: z.string().min(1),
  // Applied to every newly-created company in this save, same as the
  // existing AI-research transfer flow's payload-level fields — an existing
  // company being updated keeps its own current stage/assignee untouched.
  assignedToId: z.string().min(1, { error: "Choose a salesperson to assign new companies to." }),
  pipelineStageId: z.string().min(1, { error: "Choose an initial pipeline stage for new companies." }),
  rows: z.array(CompetitionLocatorRowDecisionSchema).min(1, { error: "Select at least one result to save." }),
});

export type CompetitionLocatorSavePayload = z.infer<typeof CompetitionLocatorSaveSchema>;
