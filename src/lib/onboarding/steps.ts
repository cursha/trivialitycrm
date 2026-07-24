// Fixed, table-driven first-login onboarding checklist. Steps are filtered
// per user by permission (an ordinary Salesperson never sees an admin-only
// step) and completion is tracked per user via UserOnboardingStep — a
// simple manual "mark done" checkbox, not auto-inferred from other data, so
// the checklist behaves predictably and never silently completes itself.
// Never blocks any other part of the app — it's a reachable checklist, not
// a gate.

export type OnboardingStepKey =
  | "review_org_settings"
  | "confirm_lead_types_pipeline"
  | "add_competitor"
  | "add_first_company"
  | "review_ai_prompt"
  | "run_first_search"
  | "transfer_lead"
  | "schedule_follow_up"
  | "review_my_day"
  | "configure_integrations";

export type OnboardingStepDefinition = {
  key: OnboardingStepKey;
  label: string;
  description: string;
  href: string;
  /** Permission required to even see this step. Omitted for steps every
   * signed-in user can do regardless of role. */
  requiresPermission?: string;
};

export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  {
    key: "review_org_settings",
    label: "Review organization settings",
    description: "Check your organization's name, locale, and business contact info.",
    href: "/administration/organization",
    requiresPermission: "manage_organization_settings",
  },
  {
    key: "confirm_lead_types_pipeline",
    label: "Confirm lead types and pipeline stages",
    description: "Make sure the lead types and pipeline stages match how your team actually sells.",
    href: "/settings/lead-types",
    requiresPermission: "manage_settings",
  },
  {
    key: "add_competitor",
    label: "Add your competitors",
    description: "List the competitors your AI research and reports should track.",
    href: "/competitors",
    requiresPermission: "manage_competitors",
  },
  {
    key: "add_first_company",
    label: "Add or import your first company",
    description: "Create a company by hand, or import a list from a spreadsheet.",
    href: "/companies/new",
    requiresPermission: "add_leads",
  },
  {
    key: "review_ai_prompt",
    label: "Create or review an AI research prompt",
    description: "Set up the prompt AI lead research will use to find and qualify businesses.",
    href: "/leads/prompts",
    requiresPermission: "manage_prompts",
  },
  {
    key: "run_first_search",
    label: "Run your first AI research search",
    description: "Kick off a search and see AI-researched leads come in.",
    href: "/leads/searches/new",
    requiresPermission: "run_research",
  },
  {
    key: "transfer_lead",
    label: "Transfer a lead into your pipeline",
    description: "Select a researched result you like and transfer it into the CRM.",
    href: "/leads/searches",
    requiresPermission: "transfer_leads",
  },
  {
    key: "schedule_follow_up",
    label: "Schedule a follow-up",
    description: "Open any company and schedule your next follow-up on it.",
    href: "/dashboard",
  },
  {
    key: "review_my_day",
    label: "Review My Day",
    description: "See what's due, what's overdue, and what's newly assigned to you.",
    href: "/dashboard",
  },
  {
    key: "configure_integrations",
    label: "Review AI and email integration status",
    description: "Confirm your organization's AI research and transactional email are configured as expected.",
    href: "/administration/integrations",
    requiresPermission: "view_integrations",
  },
];

export function visibleOnboardingSteps(hasPermission: (permissionKey: string) => boolean): OnboardingStepDefinition[] {
  return ONBOARDING_STEPS.filter((step) => !step.requiresPermission || hasPermission(step.requiresPermission));
}
