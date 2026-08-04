import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";
import type { PipelineStageOutcome } from "../src/generated/prisma/enums";
import type { Prisma } from "../src/generated/prisma/client";

// Duplicated from src/lib/auth/password.ts rather than imported: that module
// is guarded with `import "server-only"`, which throws under plain Node/tsx
// execution (this seed script runs outside Next's "react-server" bundler
// condition). Keep this cost factor in sync with password.ts's.
const BCRYPT_COST_FACTOR = 12;

const pipelineStages: { name: string; isDefault: boolean; outcomeType: PipelineStageOutcome | null }[] = [
  { name: "New", isDefault: true, outcomeType: null },
  { name: "Material Sent", isDefault: false, outcomeType: null },
  { name: "Demo Given", isDefault: false, outcomeType: null },
  { name: "Trial", isDefault: false, outcomeType: null },
  { name: "Booked", isDefault: false, outcomeType: null },
  { name: "Won", isDefault: false, outcomeType: "WON" },
  { name: "Lost", isDefault: false, outcomeType: "LOST" },
];

const rejectionReasons = [
  "Poor Fit",
  "Closed",
  "Chain Decision",
  "Already Has Trivia",
  "Bad Contact Information",
  "Other",
  // Competition Locator verification-standard rejections (run-search.ts's
  // COMPETITOR-mode guards) — "Closed" above already covers the
  // permanently-closed-venue case, so it's reused rather than duplicated.
  "Trivia Event Cancelled or One-Time Only",
  "Outside Requested Country/Region",
  "Different Trivia Provider",
  "Insufficient Verifiable Evidence",
];

const roles = ["Administrator", "Manager", "Salesperson"] as const;

const LEADS_CATEGORY = "Leads & Companies";
const WORKSPACE_CATEGORY = "Sales Workspace";
const REPORTING_CATEGORY = "Reporting";
const COMMUNICATIONS_CATEGORY = "Communications";
const DATA_QUALITY_CATEGORY = "Data Quality";
const ADMINISTRATION_CATEGORY = "Administration";
const ROUTE_PLANNING_CATEGORY = "Route Planning";
const SALES_LISTS_CATEGORY = "Sales Lists & Campaigns";

const permissions: { key: string; label: string; category: string; description: string }[] = [
  { key: "view_all_leads", label: "View all leads", category: LEADS_CATEGORY, description: "View every company and contact in the CRM, regardless of assignment or team." },
  { key: "view_team_leads", label: "View team leads", category: LEADS_CATEGORY, description: "View companies and contacts assigned to your team." },
  { key: "view_assigned_leads", label: "View assigned leads", category: LEADS_CATEGORY, description: "View companies and contacts assigned to you." },
  { key: "add_leads", label: "Add leads", category: LEADS_CATEGORY, description: "Create new companies." },
  { key: "edit_leads", label: "Edit leads", category: LEADS_CATEGORY, description: "Edit company and contact details." },
  { key: "delete_leads", label: "Delete leads", category: LEADS_CATEGORY, description: "Archive a company (and, for an Administrator, permanently delete an already-archived one)." },
  { key: "reassign_leads", label: "Reassign leads", category: LEADS_CATEGORY, description: "Assign or reassign a company to a different salesperson." },
  { key: "import_leads", label: "Import leads", category: LEADS_CATEGORY, description: "Import companies from a spreadsheet." },
  { key: "export_leads", label: "Export leads", category: LEADS_CATEGORY, description: "Export companies and search results to CSV/Excel." },
  { key: "manage_users", label: "Manage users", category: ADMINISTRATION_CATEGORY, description: "Create and edit user accounts, assign roles and teams, and activate or deactivate access." },
  { key: "manage_prompts", label: "Manage prompts", category: LEADS_CATEGORY, description: "Create and edit reusable AI research prompts." },
  { key: "manage_competitors", label: "Manage competitors", category: LEADS_CATEGORY, description: "Manage the list of competitors." },
  { key: "manage_settings", label: "Manage settings", category: ADMINISTRATION_CATEGORY, description: "Edit lead types, pipeline stages, rejection reasons, and workspace threshold settings." },
  { key: "restore_rejected", label: "Restore rejected AI search results", category: LEADS_CATEGORY, description: "Restore an AI research result that was previously rejected." },
  { key: "restore_archived_leads", label: "Restore archived companies", category: LEADS_CATEGORY, description: "Restore an archived company back to active." },
  { key: "run_research", label: "Run AI lead research searches", category: LEADS_CATEGORY, description: "Start a new AI-assisted lead research search." },
  { key: "run_competition_locator", label: "Run Competition Locator", category: LEADS_CATEGORY, description: "Start and manage Competition Locator competitor-discovery runs." },
  { key: "review_research_results", label: "Review AI research results", category: LEADS_CATEGORY, description: "Review and act on AI research results." },
  { key: "transfer_leads", label: "Transfer AI research results to the CRM", category: LEADS_CATEGORY, description: "Transfer AI research results into the CRM as companies." },
  { key: "view_evidence", label: "View AI research evidence and citations", category: LEADS_CATEGORY, description: "View the evidence and citations behind an AI research score." },
  // Module Four: Sales Workspace
  { key: "bulk_update_leads", label: "Use bulk actions on leads", category: WORKSPACE_CATEGORY, description: "Use bulk actions (assign, change stage, archive, and more) on multiple leads at once." },
  { key: "manage_territories", label: "Manage territories", category: WORKSPACE_CATEGORY, description: "Create and edit sales territories." },
  { key: "create_shared_views", label: "Create shared saved views", category: WORKSPACE_CATEGORY, description: "Create saved pipeline views shared with the whole team." },
  { key: "view_manager_workspace", label: "View manager workspace", category: WORKSPACE_CATEGORY, description: "View the Manager Workspace — team workload, coverage, and pipeline summaries." },
  // Module Five: Reporting and Analytics
  { key: "view_own_reports", label: "View own reports", category: REPORTING_CATEGORY, description: "View reports scoped to your own leads." },
  { key: "view_team_reports", label: "View team reports", category: REPORTING_CATEGORY, description: "View reports scoped to your team." },
  { key: "view_all_reports", label: "View all reports", category: REPORTING_CATEGORY, description: "View reports across the whole organization." },
  { key: "export_reports", label: "Export reports", category: REPORTING_CATEGORY, description: "Export reports to CSV/Excel." },
  { key: "manage_scheduled_reports", label: "Manage scheduled reports", category: REPORTING_CATEGORY, description: "Create and edit scheduled report deliveries." },
  { key: "view_ai_costs", label: "View AI research cost estimates", category: REPORTING_CATEGORY, description: "View AI research cost estimates in reports." },
  { key: "view_competitor_reports", label: "View competitor reports", category: REPORTING_CATEGORY, description: "View competitor-focused reports." },
  // Module Six: Communications and Follow-up Automation
  { key: "connect_mailbox", label: "Connect a mailbox for sending email", category: COMMUNICATIONS_CATEGORY, description: "Connect your own mailbox for sending email from the CRM." },
  { key: "send_email", label: "Send email", category: COMMUNICATIONS_CATEGORY, description: "Send email to a contact." },
  { key: "schedule_email", label: "Schedule email", category: COMMUNICATIONS_CATEGORY, description: "Schedule an email to send later." },
  { key: "manage_personal_templates", label: "Manage personal email templates", category: COMMUNICATIONS_CATEGORY, description: "Create and edit your own personal email templates." },
  { key: "manage_shared_templates", label: "Manage shared email templates", category: COMMUNICATIONS_CATEGORY, description: "Create and edit email templates shared with the whole team." },
  { key: "manage_sequences", label: "Manage follow-up sequences", category: COMMUNICATIONS_CATEGORY, description: "Design multi-step, explicitly-enrolled follow-up sequences." },
  { key: "enroll_in_sequences", label: "Enroll leads in follow-up sequences", category: COMMUNICATIONS_CATEGORY, description: "Enroll a company in an existing follow-up sequence." },
  { key: "view_team_communications", label: "View team communications", category: COMMUNICATIONS_CATEGORY, description: "Review inbound messages that couldn't be automatically matched to a contact." },
  { key: "manage_calendar_connections", label: "Manage calendar connections", category: COMMUNICATIONS_CATEGORY, description: "Connect a calendar and schedule, reschedule, or cancel appointments." },
  { key: "manage_communication_compliance", label: "Manage communication consent and compliance", category: COMMUNICATIONS_CATEGORY, description: "View and record contact consent for CASL/CAN-SPAM compliance." },
  { key: "send_bulk_email", label: "Send bulk email", category: COMMUNICATIONS_CATEGORY, description: "Send email to more than one contact at a time." },
  // Module Seven: Data Quality, Duplicate Management, Record Merging, and
  // Enrichment History
  { key: "view_data_quality", label: "View the data quality workspace", category: DATA_QUALITY_CATEGORY, description: "View the data quality dashboard and its counts." },
  { key: "review_data_quality", label: "Review data quality issues and possible duplicates", category: DATA_QUALITY_CATEGORY, description: "Review data-quality issues and possible duplicate records." },
  { key: "manage_data_quality_rules", label: "Manage data quality rules", category: DATA_QUALITY_CATEGORY, description: "Create, edit, enable/disable, and archive data-quality rules." },
  { key: "merge_companies", label: "Merge duplicate companies", category: DATA_QUALITY_CATEGORY, description: "Merge two duplicate companies into one, safely, without losing history." },
  { key: "merge_contacts", label: "Merge duplicate contacts", category: DATA_QUALITY_CATEGORY, description: "Merge two duplicate contacts into one, safely, without losing history." },
  { key: "run_duplicate_scan", label: "Run a data quality scan", category: DATA_QUALITY_CATEGORY, description: "Trigger a scan for missing/invalid data and possible duplicates." },
  { key: "review_enrichment", label: "Review enrichment suggestions", category: DATA_QUALITY_CATEGORY, description: "Request and review data-enrichment suggestions before applying them." },
  { key: "manage_enrichment_settings", label: "Manage enrichment settings", category: DATA_QUALITY_CATEGORY, description: "Configure the data-enrichment provider and its settings." },
  // Module 8A: Essential Version 1 Administration
  { key: "view_administration", label: "View administration home", category: ADMINISTRATION_CATEGORY, description: "View the Administration home page and its safe summary cards." },
  { key: "manage_organization_settings", label: "Manage organization settings", category: ADMINISTRATION_CATEGORY, description: "Edit organization-wide settings — name, locale defaults, and business contact info." },
  { key: "manage_roles", label: "Manage roles and permissions", category: ADMINISTRATION_CATEGORY, description: "Create roles, duplicate them, and edit permission grants." },
  { key: "manage_ai_settings", label: "Manage AI settings", category: ADMINISTRATION_CATEGORY, description: "Configure AI research settings and budget controls." },
  { key: "view_audit_log", label: "View audit log", category: ADMINISTRATION_CATEGORY, description: "View the administrative audit log." },
  { key: "export_audit_log", label: "Export audit log", category: ADMINISTRATION_CATEGORY, description: "Export the audit log to a redacted CSV file." },
  { key: "view_system_health", label: "View system health", category: ADMINISTRATION_CATEGORY, description: "View web, database, worker, and queue health status." },
  { key: "manage_background_jobs", label: "Manage background jobs", category: ADMINISTRATION_CATEGORY, description: "Retry or cancel eligible background jobs." },
  // Module Nine: Essential Version 1 Integrations
  { key: "view_integrations", label: "View integrations", category: ADMINISTRATION_CATEGORY, description: "View the Integrations page — AI and email provider status, configuration, and usage." },
  { key: "manage_ai_integration", label: "Manage AI integration", category: ADMINISTRATION_CATEGORY, description: "Enable or disable live AI research and run a safe AI provider connection test." },
  { key: "manage_email_integration", label: "Manage email integration", category: ADMINISTRATION_CATEGORY, description: "Enable or disable live transactional email sending." },
  { key: "send_test_email", label: "Send test email", category: ADMINISTRATION_CATEGORY, description: "Send one controlled transactional test email to an address you enter." },
  { key: "view_provider_usage", label: "View provider usage", category: ADMINISTRATION_CATEGORY, description: "View AI and email provider usage totals and recent activity." },
  // Route Plan: private per-user door-to-door visit lists, exported as an
  // EZRoutePlanner-compatible CSV. configure_route_plan_lead_types is
  // separate from manage_route_plan (and Administrator-only by default,
  // same as manage_settings) — deciding which lead types are eligible is a
  // workspace-wide configuration choice, not a personal route action.
  { key: "view_route_plan", label: "View Route Plan", category: ROUTE_PLANNING_CATEGORY, description: "See the Route Plan header count and open your own Route Plan page." },
  { key: "manage_route_plan", label: "Manage Route Plan", category: ROUTE_PLANNING_CATEGORY, description: "Add, remove, and clear companies in your own Route Plan." },
  { key: "export_route_plan", label: "Export Route Plan", category: ROUTE_PLANNING_CATEGORY, description: "Download your Route Plan as a CSV file." },
  { key: "configure_route_plan_lead_types", label: "Configure Route Plan lead types", category: ROUTE_PLANNING_CATEGORY, description: "Choose which lead types are eligible for Route Planning." },
  // Campaign and Calling Lists.
  { key: "view_sales_lists", label: "View sales lists", category: SALES_LISTS_CATEGORY, description: "View sales lists you own or that have been shared with you." },
  { key: "create_sales_lists", label: "Create sales lists", category: SALES_LISTS_CATEGORY, description: "Build and save a new fixed or dynamic sales list." },
  { key: "manage_own_sales_lists", label: "Manage own sales lists", category: SALES_LISTS_CATEGORY, description: "Edit, share, archive, or delete a sales list you created." },
  { key: "manage_all_sales_lists", label: "Manage all sales lists", category: SALES_LISTS_CATEGORY, description: "Edit, share, archive, or delete any sales list, regardless of who created it." },
  { key: "use_calling_lists", label: "Use calling lists", category: SALES_LISTS_CATEGORY, description: "Start and work through a guided calling session from a calling list." },
  { key: "manage_call_outcomes", label: "Manage call outcomes", category: SALES_LISTS_CATEGORY, description: "Add, edit, reorder, and activate or deactivate call outcomes and their default actions." },
  { key: "create_campaigns", label: "Create email campaigns", category: SALES_LISTS_CATEGORY, description: "Build a single-email or multi-step email campaign from a sales list." },
  { key: "send_campaigns", label: "Approve and send email campaigns", category: SALES_LISTS_CATEGORY, description: "Approve a campaign's preview and send it now or on a schedule." },
  { key: "view_campaign_reports", label: "View campaign reports", category: SALES_LISTS_CATEGORY, description: "View campaign and calling-session reporting and dashboards." },
  { key: "manage_campaign_instructions", label: "Manage reusable campaign instructions", category: SALES_LISTS_CATEGORY, description: "Create and edit reusable, house-wide AI personalization instructions campaign creators can apply." },
];

// Initial role -> permission grants. All grants are stored as editable
// RolePermission rows (table-driven), not hardcoded logic — this matrix is
// only the *seeded default*; an Administrator can change it afterward via
// the Roles admin screen.
const roleGrants: Record<(typeof roles)[number], string[]> = {
  Administrator: permissions.map((p) => p.key),
  Manager: [
    "view_team_leads",
    "add_leads",
    "edit_leads",
    "reassign_leads",
    "bulk_update_leads",
    "create_shared_views",
    "view_manager_workspace",
    "view_own_reports",
    "view_team_reports",
    "export_reports",
    "view_competitor_reports",
    "connect_mailbox",
    "send_email",
    "schedule_email",
    "manage_personal_templates",
    "enroll_in_sequences",
    "view_team_communications",
    "manage_calendar_connections",
    "view_route_plan",
    "manage_route_plan",
    "export_route_plan",
    "view_sales_lists",
    "create_sales_lists",
    "manage_own_sales_lists",
    "use_calling_lists",
    "create_campaigns",
    "send_campaigns",
    "view_campaign_reports",
  ],
  Salesperson: [
    "view_assigned_leads",
    "add_leads",
    "edit_leads",
    "view_route_plan",
    "manage_route_plan",
    "export_route_plan",
    "view_own_reports",
    "connect_mailbox",
    "send_email",
    "schedule_email",
    "manage_personal_templates",
    "enroll_in_sequences",
    "manage_calendar_connections",
    "view_sales_lists",
    "create_sales_lists",
    "manage_own_sales_lists",
    "use_calling_lists",
  ],
};

async function seedPipelineStages() {
  for (const [index, stage] of pipelineStages.entries()) {
    await prisma.pipelineStage.upsert({
      where: { name: stage.name },
      // outcomeType is a classification of the seed-defined stage itself
      // (like a permission's label), kept in sync on reseed — unlike
      // sortOrder/active, which are operational settings an Administrator
      // may have already changed and must not be silently overwritten.
      update: { outcomeType: stage.outcomeType },
      create: { name: stage.name, isDefault: stage.isDefault, sortOrder: index, outcomeType: stage.outcomeType },
    });
  }
  console.log(`Seeded ${pipelineStages.length} pipeline stages.`);
}

async function seedRejectionReasons() {
  for (const [index, name] of rejectionReasons.entries()) {
    await prisma.rejectionReason.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: index },
    });
  }
  console.log(`Seeded ${rejectionReasons.length} rejection reasons.`);
}

// Campaign and Calling Lists: seeded starting call outcomes. defaultPipelineStageId
// is resolved from PipelineStage.outcomeType ("LOST"), never a hardcoded stage
// name, matching every other Won/Lost-aware lookup in this app.
const callOutcomes: {
  name: string;
  requiresNotes?: boolean;
  requiresNextAction?: boolean;
  defaultNextActionDays?: number;
  defaultNextActionTitle?: string;
  opensEmailComposer?: boolean;
  requiresRejectionReason?: boolean;
  skipRestOfSession?: boolean;
  appliesDoNotContact?: boolean;
  resultCategory?: "UNREACHABLE" | "INTERESTED" | "DEMO_REQUESTED" | "NOT_INTERESTED";
  useLostStage?: boolean;
}[] = [
  { name: "No Answer", requiresNextAction: true, defaultNextActionDays: 2, defaultNextActionTitle: "Follow up call", resultCategory: "UNREACHABLE" },
  { name: "Left Message", requiresNextAction: true, defaultNextActionDays: 3, defaultNextActionTitle: "Follow up on voicemail", resultCategory: "UNREACHABLE" },
  { name: "Spoke to Contact", requiresNotes: true },
  { name: "Wrong Contact", requiresNotes: true, requiresNextAction: true, defaultNextActionDays: 3, defaultNextActionTitle: "Identify correct contact", resultCategory: "UNREACHABLE" },
  { name: "Send Information", opensEmailComposer: true, requiresNextAction: true, defaultNextActionDays: 3, defaultNextActionTitle: "Follow up after sending information" },
  { name: "Interested", requiresNotes: true, requiresNextAction: true, defaultNextActionDays: 2, defaultNextActionTitle: "Follow up with interested lead", resultCategory: "INTERESTED" },
  { name: "Demo Requested", requiresNotes: true, requiresNextAction: true, defaultNextActionDays: 1, defaultNextActionTitle: "Schedule demo", resultCategory: "DEMO_REQUESTED" },
  { name: "Call Back Later", requiresNextAction: true, defaultNextActionDays: 7, defaultNextActionTitle: "Call back" },
  { name: "Not Interested", requiresNotes: true, requiresRejectionReason: true, skipRestOfSession: true, resultCategory: "NOT_INTERESTED", useLostStage: true },
  { name: "Do Not Contact", requiresNotes: true, skipRestOfSession: true, appliesDoNotContact: true, resultCategory: "NOT_INTERESTED" },
  { name: "Invalid Number", skipRestOfSession: true, resultCategory: "UNREACHABLE" },
];

async function seedCallOutcomes() {
  const lostStage = await prisma.pipelineStage.findFirst({ where: { outcomeType: "LOST" } });

  for (const [index, outcome] of callOutcomes.entries()) {
    await prisma.callOutcome.upsert({
      where: { name: outcome.name },
      // Only descriptive/behavioral configuration is synced on re-run — active/
      // sortOrder are operational settings an Administrator may have already
      // changed, matching pipelineStage's own outcomeType-sync precedent.
      update: {
        requiresNotes: outcome.requiresNotes ?? false,
        requiresNextAction: outcome.requiresNextAction ?? false,
        defaultNextActionDays: outcome.defaultNextActionDays ?? null,
        defaultNextActionTitle: outcome.defaultNextActionTitle ?? null,
        defaultPipelineStageId: outcome.useLostStage ? (lostStage?.id ?? null) : null,
        opensEmailComposer: outcome.opensEmailComposer ?? false,
        requiresRejectionReason: outcome.requiresRejectionReason ?? false,
        skipRestOfSession: outcome.skipRestOfSession ?? false,
        appliesDoNotContact: outcome.appliesDoNotContact ?? false,
        resultCategory: outcome.resultCategory ?? null,
      },
      create: {
        name: outcome.name,
        sortOrder: index,
        requiresNotes: outcome.requiresNotes ?? false,
        requiresNextAction: outcome.requiresNextAction ?? false,
        defaultNextActionDays: outcome.defaultNextActionDays ?? null,
        defaultNextActionTitle: outcome.defaultNextActionTitle ?? null,
        defaultPipelineStageId: outcome.useLostStage ? (lostStage?.id ?? null) : null,
        opensEmailComposer: outcome.opensEmailComposer ?? false,
        requiresRejectionReason: outcome.requiresRejectionReason ?? false,
        skipRestOfSession: outcome.skipRestOfSession ?? false,
        appliesDoNotContact: outcome.appliesDoNotContact ?? false,
        resultCategory: outcome.resultCategory ?? null,
      },
    });
  }
  console.log(`Seeded ${callOutcomes.length} call outcomes.`);
}

async function seedPermissions() {
  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      // category/description are synced on every re-run (like a
      // permission's label already was) — these are descriptive metadata
      // about what the permission does, not an operational setting an
      // Administrator might have customized, so keeping them in sync with
      // the source of truth here is correct, matching pipelineStage's own
      // "sync outcomeType, leave sortOrder/active alone" precedent.
      update: { label: permission.label, category: permission.category, description: permission.description },
      create: permission,
    });
  }
  console.log(`Seeded ${permissions.length} permissions.`);
}

async function seedRolesAndGrants() {
  for (const [index, roleName] of roles.entries()) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, sortOrder: index },
    });

    const grantedKeys = roleGrants[roleName];
    for (const key of grantedKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: { allowed: true },
        create: { roleId: role.id, permissionId: permission.id, allowed: true },
      });
    }
  }
  console.log(`Seeded ${roles.length} roles and their permission grants.`);
}

// Module Seven default rules. Idempotent by (name, entityType) at the app
// layer rather than a DB unique constraint — a global unique on `name`
// would block an admin from legitimately naming two rules for different
// entity types the same thing (e.g. "Missing phone" for both COMPANY and
// CONTACT). On re-run, only description/severity/field/config are synced
// (matching pipelineStage's outcomeType-sync precedent below) — enabled/
// sortOrder are left alone once an Administrator may have changed them.
const dataQualityRules: {
  name: string;
  description: string;
  entityType: "COMPANY" | "CONTACT";
  field: string;
  ruleType:
    | "REQUIRED_FIELD"
    | "INVALID_EMAIL_FORMAT"
    | "INVALID_PHONE_FORMAT"
    | "INVALID_URL_FORMAT"
    | "DUPLICATE_EXACT_MATCH"
    | "DUPLICATE_NORMALIZED_MATCH"
    | "DUPLICATE_FUZZY_MATCH"
    | "STALE_RECORD"
    | "CUSTOM_REVIEW_FLAG";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  enabled: boolean;
  config: Record<string, unknown>;
}[] = [
  { name: "Company missing phone", description: "Flags a company with no phone number on file.", entityType: "COMPANY", field: "phone", ruleType: "REQUIRED_FIELD", severity: "MEDIUM", enabled: true, config: {} },
  { name: "Company missing email", description: "Flags a company with no email address on file.", entityType: "COMPANY", field: "email", ruleType: "REQUIRED_FIELD", severity: "MEDIUM", enabled: true, config: {} },
  { name: "Company missing street address", description: "Flags a company with no street address on file.", entityType: "COMPANY", field: "address1", ruleType: "REQUIRED_FIELD", severity: "MEDIUM", enabled: true, config: {} },
  { name: "Company missing website", description: "Flags a company with no website URL on file.", entityType: "COMPANY", field: "websiteUrl", ruleType: "REQUIRED_FIELD", severity: "LOW", enabled: true, config: {} },
  { name: "Contact missing phone", description: "Flags a contact with no phone number on file.", entityType: "CONTACT", field: "phone", ruleType: "REQUIRED_FIELD", severity: "LOW", enabled: true, config: {} },
  { name: "Contact missing email", description: "Flags a contact with no email address on file.", entityType: "CONTACT", field: "email", ruleType: "REQUIRED_FIELD", severity: "MEDIUM", enabled: true, config: {} },
  { name: "Invalid company email format", description: "Flags a company email that is malformed or a placeholder address.", entityType: "COMPANY", field: "email", ruleType: "INVALID_EMAIL_FORMAT", severity: "HIGH", enabled: true, config: {} },
  { name: "Invalid contact email format", description: "Flags a contact email that is malformed or a placeholder address.", entityType: "CONTACT", field: "email", ruleType: "INVALID_EMAIL_FORMAT", severity: "HIGH", enabled: true, config: {} },
  { name: "Invalid company phone format", description: "Flags a company phone number that isn't a plausible North American number.", entityType: "COMPANY", field: "phone", ruleType: "INVALID_PHONE_FORMAT", severity: "MEDIUM", enabled: true, config: {} },
  { name: "Invalid contact phone format", description: "Flags a contact phone number that isn't a plausible North American number.", entityType: "CONTACT", field: "phone", ruleType: "INVALID_PHONE_FORMAT", severity: "MEDIUM", enabled: true, config: {} },
  { name: "Invalid company website URL", description: "Flags a company website URL that doesn't look like a real address.", entityType: "COMPANY", field: "websiteUrl", ruleType: "INVALID_URL_FORMAT", severity: "LOW", enabled: true, config: {} },
  { name: "Possible duplicate companies — normalized match", description: "Flags companies whose normalized name, phone, email, or website domain matches another company.", entityType: "COMPANY", field: "name", ruleType: "DUPLICATE_NORMALIZED_MATCH", severity: "HIGH", enabled: true, config: {} },
  { name: "Possible duplicate companies — exact match", description: "Flags companies with byte-identical email, phone, or website domain. Disabled by default — normalized match already covers this case.", entityType: "COMPANY", field: "email", ruleType: "DUPLICATE_EXACT_MATCH", severity: "HIGH", enabled: false, config: {} },
  { name: "Possible duplicate companies — similar name", description: "Flags companies in the same city/region with a very similar (but not identical) name.", entityType: "COMPANY", field: "name", ruleType: "DUPLICATE_FUZZY_MATCH", severity: "MEDIUM", enabled: true, config: { minSimilarity: 85 } },
  { name: "Possible duplicate contacts — normalized match", description: "Flags contacts whose normalized email or full name matches another contact.", entityType: "CONTACT", field: "email", ruleType: "DUPLICATE_NORMALIZED_MATCH", severity: "MEDIUM", enabled: true, config: {} },
  { name: "Stale company record", description: "Flags a company with no logged activity in a long time.", entityType: "COMPANY", field: "activity", ruleType: "STALE_RECORD", severity: "LOW", enabled: true, config: { staleDays: 180 } },
];

async function seedDataQualityRules() {
  const attributedTo = await prisma.user.findFirst({ where: { role: { name: "Administrator" } }, orderBy: { createdAt: "asc" } });
  if (!attributedTo) {
    console.log("No Administrator user exists yet — skipping default data quality rules (they'll need a creator; re-run the seed after creating one).");
    return;
  }

  const nextSortOrderByEntity: Record<string, number> = {};
  for (const rule of dataQualityRules) {
    const existing = await prisma.dataQualityRule.findFirst({ where: { name: rule.name, entityType: rule.entityType } });
    if (existing) {
      await prisma.dataQualityRule.update({
        where: { id: existing.id },
        data: { description: rule.description, field: rule.field, ruleType: rule.ruleType, severity: rule.severity, updatedById: attributedTo.id },
      });
    } else {
      const sortOrder = nextSortOrderByEntity[rule.entityType] ?? 0;
      nextSortOrderByEntity[rule.entityType] = sortOrder + 1;
      await prisma.dataQualityRule.create({
        data: {
          name: rule.name,
          description: rule.description,
          entityType: rule.entityType,
          field: rule.field,
          ruleType: rule.ruleType,
          severity: rule.severity,
          enabled: rule.enabled,
          sortOrder,
          config: rule.config as Prisma.InputJsonValue,
          createdById: attributedTo.id,
        },
      });
    }
  }
  console.log(`Seeded ${dataQualityRules.length} default data quality rules.`);
}

// Module 8A: one default OrganizationSettings row (id fixed at 1), same
// upsert-by-id-1 idiom as WorkspaceSettings. Only genuinely-known facts are
// seeded (the app's own documented business timezone, the two-country
// scope every other part of this app already assumes) — business contact
// fields are left blank rather than invented, matching this codebase's
// standing rule to never fabricate real-world facts.
async function seedOrganizationSettings() {
  const defaultStage = await prisma.pipelineStage.findFirst({ where: { isDefault: true } });

  await prisma.organizationSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      organizationName: "Triviality",
      defaultCountry: "Canada",
      defaultRegion: "Ontario",
      defaultTimezone: "America/Toronto",
      defaultCurrency: "CAD",
      defaultDateFormat: "YYYY-MM-DD",
      defaultPipelineStageId: defaultStage?.id ?? null,
    },
  });
  console.log("Seeded default organization settings.");
}

// Module 8A: one default AiSettings row — seeded from the legacy
// AI_DAILY_BUDGET_USD/AI_MONTHLY_BUDGET_USD env vars if set (see
// src/lib/ai/budget.ts's doc comment: after this one-time seed, the DB row
// is authoritative and editable without a redeploy).
async function seedAiSettings() {
  await prisma.aiSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      dailyBudgetUsd: process.env.AI_DAILY_BUDGET_USD ? Number(process.env.AI_DAILY_BUDGET_USD) : null,
      monthlyBudgetUsd: process.env.AI_MONTHLY_BUDGET_USD ? Number(process.env.AI_MONTHLY_BUDGET_USD) : null,
    },
  });
  console.log("Seeded default AI settings.");
}

// Module Nine: one default IntegrationSettings row — emailSendingEnabled
// starts false regardless of whether RESEND_API_KEY happens to be set, same
// "seeded default, admin-editable afterward" idiom as AiSettings/
// OrganizationSettings.
async function seedIntegrationSettings() {
  await prisma.integrationSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  console.log("Seeded default integration settings.");
}

async function seedBootstrapAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log("SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not both set — skipping bootstrap Administrator.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists — skipping bootstrap Administrator creation.`);
    return;
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "Administrator" } });
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);

  await prisma.user.create({
    data: {
      name: "Administrator",
      email,
      passwordHash,
      roleId: adminRole.id,
      // The operator chose this password themselves via environment
      // variables, unlike accounts an admin later creates for someone
      // else, so there's nothing to force a change away from.
      mustChangePassword: false,
    },
  });
  console.log(`Created bootstrap Administrator ${email}.`);
}

async function main() {
  await seedPipelineStages();
  await seedRejectionReasons();
  await seedCallOutcomes();
  await seedPermissions();
  await seedRolesAndGrants();
  await seedBootstrapAdmin();
  await seedDataQualityRules();
  await seedOrganizationSettings();
  await seedAiSettings();
  await seedIntegrationSettings();

  console.log(
    "Seed complete. No Lead Types, Competitors, or sample Companies were created — " +
      "create these through the application once logged in.",
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
