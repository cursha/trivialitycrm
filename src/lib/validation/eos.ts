import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined));

export const HistoricalScoreEntrySchema = z.object({
  foodBeverageFocus: z.coerce.number().int().min(0).max(15),
  weeknightRevenueOpportunity: z.coerce.number().int().min(0).max(15),
  communityEngagement: z.coerce.number().int().min(0).max(10),
  existingEventCulture: z.coerce.number().int().min(0).max(10),
  groupSeatingLayout: z.coerce.number().int().min(0).max(10),
  capacityOperationalSuitability: z.coerce.number().int().min(0).max(10),
  decisionMakerAccessibility: z.coerce.number().int().min(0).max(10),
  marketingActivityVisibility: z.coerce.number().int().min(0).max(10),
  turnkeyImplementationReadiness: z.coerce.number().int().min(0).max(5),
  competitiveOpportunity: z.coerce.number().int().min(0).max(5),
  confidenceLevel: z.enum(["HIGH", "MEDIUM", "LOW"]),
  primaryClassification: z.enum([
    "ENTERTAINMENT_READY",
    "GREENFIELD",
    "REPLACEMENT",
    "NEEDS_QUALIFICATION",
    "EXISTING_CUSTOMER",
  ]),
  secondaryTags: z.array(z.enum(["EASY_WIN", "REVENUE_READY", "NO_HOST_READY"])).default([]),
  salesPriorityScore: z.coerce.number().int().min(0).optional(),
  scoreExplanation: optionalText(5000),
  verifiedEvidenceSummary: optionalText(5000),
  inferredEvidenceSummary: optionalText(5000),
  missingInformation: optionalText(5000),
  recommendedSalesApproach: optionalText(2000),
  recommendedNextAction: optionalText(2000),
  scoringVersion: z.string().trim().min(1, { error: "Enter a scoring version." }).max(40),
  isExistingCustomer: z.boolean().default(false),
  isQualified: z.boolean().default(false),
  doNotContact: z.boolean().default(false),
  exclusionReason: optionalText(500),
});

export const EvidenceEntrySchema = z.object({
  category: z.enum([
    "FOOD_BEVERAGE_FOCUS",
    "WEEKNIGHT_REVENUE_OPPORTUNITY",
    "COMMUNITY_ENGAGEMENT",
    "EXISTING_EVENT_CULTURE",
    "GROUP_SEATING_LAYOUT",
    "CAPACITY_OPERATIONAL_SUITABILITY",
    "DECISION_MAKER_ACCESSIBILITY",
    "MARKETING_ACTIVITY_VISIBILITY",
    "TURNKEY_IMPLEMENTATION_READINESS",
    "COMPETITIVE_OPPORTUNITY",
  ]),
  sourceType: optionalText(80),
  sourceUrl: z
    .union([z.url({ error: "Enter a valid URL." }), z.literal("")])
    .optional()
    .transform((value) => (value ? value : undefined)),
  evidenceSummary: z.string().trim().min(1, { error: "Describe the evidence." }).max(2000),
  evidenceDate: z
    .string()
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : undefined)),
  verificationStatus: z.enum(["VERIFIED", "INFERRED", "UNVERIFIED", "OUTDATED", "CONTRADICTORY"]),
  reliability: z.enum(["HIGH", "MEDIUM", "LOW"]),
});
