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
];

const roles = ["Administrator", "Manager", "Salesperson"] as const;

const permissions: { key: string; label: string }[] = [
  { key: "view_all_leads", label: "View all leads" },
  { key: "view_team_leads", label: "View team leads" },
  { key: "view_assigned_leads", label: "View assigned leads" },
  { key: "add_leads", label: "Add leads" },
  { key: "edit_leads", label: "Edit leads" },
  { key: "delete_leads", label: "Delete leads" },
  { key: "reassign_leads", label: "Reassign leads" },
  { key: "import_leads", label: "Import leads" },
  { key: "export_leads", label: "Export leads" },
  { key: "manage_users", label: "Manage users" },
  { key: "manage_prompts", label: "Manage prompts" },
  { key: "manage_competitors", label: "Manage competitors" },
  { key: "manage_settings", label: "Manage settings" },
  { key: "restore_rejected", label: "Restore rejected AI search results" },
  { key: "restore_archived_leads", label: "Restore archived companies" },
  { key: "run_research", label: "Run AI lead research searches" },
  { key: "review_research_results", label: "Review AI research results" },
  { key: "transfer_leads", label: "Transfer AI research results to the CRM" },
  { key: "view_evidence", label: "View AI research evidence and citations" },
  // Module Four: Sales Workspace
  { key: "bulk_update_leads", label: "Use bulk actions on leads" },
  { key: "manage_territories", label: "Manage territories" },
  { key: "create_shared_views", label: "Create shared saved views" },
  { key: "view_manager_workspace", label: "View manager workspace" },
  // Module Five: Reporting and Analytics
  { key: "view_own_reports", label: "View own reports" },
  { key: "view_team_reports", label: "View team reports" },
  { key: "view_all_reports", label: "View all reports" },
  { key: "export_reports", label: "Export reports" },
  { key: "manage_scheduled_reports", label: "Manage scheduled reports" },
  { key: "view_ai_costs", label: "View AI research cost estimates" },
  { key: "view_competitor_reports", label: "View competitor reports" },
  // Module Six: Communications and Follow-up Automation
  { key: "connect_mailbox", label: "Connect a mailbox for sending email" },
  { key: "send_email", label: "Send email" },
  { key: "schedule_email", label: "Schedule email" },
  { key: "manage_personal_templates", label: "Manage personal email templates" },
  { key: "manage_shared_templates", label: "Manage shared email templates" },
  { key: "manage_sequences", label: "Manage follow-up sequences" },
  { key: "enroll_in_sequences", label: "Enroll leads in follow-up sequences" },
  { key: "view_team_communications", label: "View team communications" },
  { key: "manage_calendar_connections", label: "Manage calendar connections" },
  { key: "manage_communication_compliance", label: "Manage communication consent and compliance" },
  { key: "send_bulk_email", label: "Send bulk email" },
  // Module Seven: Data Quality, Duplicate Management, Record Merging, and
  // Enrichment History
  { key: "view_data_quality", label: "View the data quality workspace" },
  { key: "review_data_quality", label: "Review data quality issues and possible duplicates" },
  { key: "manage_data_quality_rules", label: "Manage data quality rules" },
  { key: "merge_companies", label: "Merge duplicate companies" },
  { key: "merge_contacts", label: "Merge duplicate contacts" },
  { key: "run_duplicate_scan", label: "Run a data quality scan" },
  { key: "review_enrichment", label: "Review enrichment suggestions" },
  { key: "manage_enrichment_settings", label: "Manage enrichment settings" },
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
  ],
  Salesperson: [
    "view_assigned_leads",
    "add_leads",
    "edit_leads",
    "view_own_reports",
    "connect_mailbox",
    "send_email",
    "schedule_email",
    "manage_personal_templates",
    "enroll_in_sequences",
    "manage_calendar_connections",
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

async function seedPermissions() {
  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: { label: permission.label },
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
  await seedPermissions();
  await seedRolesAndGrants();
  await seedBootstrapAdmin();
  await seedDataQualityRules();

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
