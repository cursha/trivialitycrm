// EOS-1.0 category maxima. Module One prepares this structure and its
// validation rules for the future scoring engine — no score generation
// happens here.
import type { ScoringCategory } from "@/generated/prisma/enums";

export const EOS_CATEGORY_MAXIMA = {
  foodBeverageFocus: 15,
  weeknightRevenueOpportunity: 15,
  communityEngagement: 10,
  existingEventCulture: 10,
  groupSeatingLayout: 10,
  capacityOperationalSuitability: 10,
  decisionMakerAccessibility: 10,
  marketingActivityVisibility: 10,
  turnkeyImplementationReadiness: 5,
  competitiveOpportunity: 5,
} as const;

export const EOS_CATEGORY_LABELS: Record<keyof typeof EOS_CATEGORY_MAXIMA, string> = {
  foodBeverageFocus: "Food and beverage focus",
  weeknightRevenueOpportunity: "Weeknight revenue opportunity",
  communityEngagement: "Community engagement",
  existingEventCulture: "Existing event culture",
  groupSeatingLayout: "Group seating and layout",
  capacityOperationalSuitability: "Capacity and operational suitability",
  decisionMakerAccessibility: "Decision-maker accessibility",
  marketingActivityVisibility: "Marketing activity and public visibility",
  turnkeyImplementationReadiness: "Turnkey implementation readiness",
  competitiveOpportunity: "Competitive opportunity",
};

export const EOS_TOTAL_MAX = Object.values(EOS_CATEGORY_MAXIMA).reduce((sum, max) => sum + max, 0);

export type EosCategoryScores = { [K in keyof typeof EOS_CATEGORY_MAXIMA]: number };

// Maps each category key here to its EvidenceRecord.category enum value —
// used by the opportunity-analysis providers (src/lib/research/providers)
// so an evidence entry can be filed against the right category.
export const EOS_CATEGORY_SCORING_CATEGORY: Record<keyof typeof EOS_CATEGORY_MAXIMA, ScoringCategory> = {
  foodBeverageFocus: "FOOD_BEVERAGE_FOCUS",
  weeknightRevenueOpportunity: "WEEKNIGHT_REVENUE_OPPORTUNITY",
  communityEngagement: "COMMUNITY_ENGAGEMENT",
  existingEventCulture: "EXISTING_EVENT_CULTURE",
  groupSeatingLayout: "GROUP_SEATING_LAYOUT",
  capacityOperationalSuitability: "CAPACITY_OPERATIONAL_SUITABILITY",
  decisionMakerAccessibility: "DECISION_MAKER_ACCESSIBILITY",
  marketingActivityVisibility: "MARKETING_ACTIVITY_VISIBILITY",
  turnkeyImplementationReadiness: "TURNKEY_IMPLEMENTATION_READINESS",
  competitiveOpportunity: "COMPETITIVE_OPPORTUNITY",
};
