// EOS-1.0 category maxima. Module One prepares this structure and its
// validation rules for the future scoring engine — no score generation
// happens here.
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
