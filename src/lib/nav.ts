// Plain data only (no React/icon imports) so it can be safely imported from
// both the server layout (for permission filtering) and the client shell
// (for rendering) without crossing a function-serialization boundary.
export type NavIconKey = "dashboard" | "building" | "calendar" | "trophy" | "settings" | "search";

export type NavItem = {
  label: string;
  href: string;
  icon: NavIconKey;
  requiresAnyPermission?: string[];
};

const LEAD_VIEW_PERMISSIONS = ["view_all_leads", "view_team_leads", "view_assigned_leads"];

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Companies", href: "/companies", icon: "building", requiresAnyPermission: LEAD_VIEW_PERMISSIONS },
  {
    label: "Leads",
    href: "/leads",
    icon: "search",
    requiresAnyPermission: ["run_research", "review_research_results", "manage_prompts", "import_leads"],
  },
  { label: "Follow-Ups", href: "/follow-ups", icon: "calendar", requiresAnyPermission: LEAD_VIEW_PERMISSIONS },
  { label: "Competitors", href: "/competitors", icon: "trophy" },
  {
    label: "Settings",
    href: "/settings",
    icon: "settings",
    requiresAnyPermission: ["manage_users", "manage_settings", "manage_competitors"],
  },
];
