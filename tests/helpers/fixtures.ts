import crypto from "node:crypto";
import { testPrisma } from "./db";
import { hashPassword } from "../../src/lib/auth/password";
import { createSession } from "../../src/lib/auth/session";

export async function createPermission(key: string, label = key) {
  return testPrisma.permission.upsert({
    where: { key },
    update: {},
    create: { key, label },
  });
}

export async function createRoleWithPermissions(name: string, permissionKeys: string[]) {
  const role = await testPrisma.role.create({ data: { name } });

  for (const key of permissionKeys) {
    const permission = await createPermission(key);
    await testPrisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id, allowed: true },
    });
  }

  return role;
}

export async function createTeam(name = `Team ${crypto.randomUUID().slice(0, 8)}`) {
  return testPrisma.team.create({ data: { name } });
}

export async function createTestUser(opts: {
  name?: string;
  email?: string;
  roleId: string;
  teamId?: string | null;
  disabled?: boolean;
}) {
  // A random, never-displayed value — these rows only ever exist in the
  // isolated test database and are truncated between test runs. Nothing
  // here is a real credential handed to anyone.
  const passwordHash = await hashPassword(crypto.randomBytes(16).toString("hex"));

  return testPrisma.user.create({
    data: {
      name: opts.name ?? "Test User",
      email: opts.email ?? `user-${crypto.randomUUID()}@example.test`,
      passwordHash,
      roleId: opts.roleId,
      teamId: opts.teamId ?? null,
      disabled: opts.disabled ?? false,
    },
  });
}

export async function createLeadTypeFixture(name = `Lead Type ${crypto.randomUUID().slice(0, 8)}`) {
  return testPrisma.leadType.create({ data: { name } });
}

export async function createPipelineStageFixture(
  name = `Stage ${crypto.randomUUID().slice(0, 8)}`,
  opts: { isDefault?: boolean; sortOrder?: number } = {},
) {
  return testPrisma.pipelineStage.create({
    data: { name, isDefault: opts.isDefault ?? false, sortOrder: opts.sortOrder ?? 0 },
  });
}

export async function createCompetitorFixture(name = `Competitor ${crypto.randomUUID().slice(0, 8)}`) {
  return testPrisma.competitor.create({ data: { name } });
}

export async function createCompanyFixture(opts: {
  name?: string;
  leadTypeId: string;
  pipelineStageId: string;
  assignedToId: string;
  createdById: string;
  competitorId?: string | null;
  status?: "ACTIVE" | "ARCHIVED";
}) {
  const name = opts.name ?? `Company ${crypto.randomUUID().slice(0, 8)}`;

  return testPrisma.company.create({
    data: {
      name,
      normalizedName: name.toLowerCase(),
      city: "Testville",
      region: "ON",
      country: "Canada",
      leadTypeId: opts.leadTypeId,
      pipelineStageId: opts.pipelineStageId,
      assignedToId: opts.assignedToId,
      createdById: opts.createdById,
      competitorId: opts.competitorId ?? null,
      status: opts.status ?? "ACTIVE",
    },
  });
}

/** Simulates a logged-in request by creating a real Session row and
 * writing its token into the mocked cookie jar (see tests/setup/mock-next.ts) —
 * exercises the real session-verification code path, not a stub. */
export async function loginAs(userId: string) {
  await createSession(userId);
}
