import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";
import type { PipelineStageOutcome } from "../src/generated/prisma/enums";

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
  ],
  Salesperson: ["view_assigned_leads", "add_leads", "edit_leads"],
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
