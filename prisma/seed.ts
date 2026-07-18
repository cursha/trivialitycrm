import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

// Duplicated from src/lib/auth/password.ts rather than imported: that module
// is guarded with `import "server-only"`, which throws under plain Node/tsx
// execution (this seed script runs outside Next's "react-server" bundler
// condition). Keep this cost factor in sync with password.ts's.
const BCRYPT_COST_FACTOR = 12;

const pipelineStages = [
  { name: "New", isDefault: true },
  { name: "Material Sent", isDefault: false },
  { name: "Demo Given", isDefault: false },
  { name: "Trial", isDefault: false },
  { name: "Booked", isDefault: false },
  { name: "Won", isDefault: false },
  { name: "Lost", isDefault: false },
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
];

// Initial role -> permission grants. All grants are stored as editable
// RolePermission rows (table-driven), not hardcoded logic — this matrix is
// only the *seeded default*; an Administrator can change it afterward via
// the Roles admin screen.
const roleGrants: Record<(typeof roles)[number], string[]> = {
  Administrator: permissions.map((p) => p.key),
  Manager: ["view_team_leads", "add_leads", "edit_leads", "reassign_leads"],
  Salesperson: ["view_assigned_leads", "add_leads", "edit_leads"],
};

async function seedPipelineStages() {
  for (const [index, stage] of pipelineStages.entries()) {
    await prisma.pipelineStage.upsert({
      where: { name: stage.name },
      update: {},
      create: { name: stage.name, isDefault: stage.isDefault, sortOrder: index },
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
