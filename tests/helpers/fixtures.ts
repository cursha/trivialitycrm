import crypto from "node:crypto";
import { testPrisma } from "./db";
import { hashPassword } from "../../src/lib/auth/password";
import { createSession } from "../../src/lib/auth/session";
import { computeNormalizedFields } from "../../src/lib/duplicates/match";
import { computeAddressNormalizedFields } from "../../src/lib/data-quality/normalize";

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

export async function createLeadTypeFixture(
  name = `Lead Type ${crypto.randomUUID().slice(0, 8)}`,
  opts: { routePlanEnabled?: boolean; routePlanSlug?: string | null } = {},
) {
  return testPrisma.leadType.create({
    data: { name, routePlanEnabled: opts.routePlanEnabled ?? false, routePlanSlug: opts.routePlanSlug ?? null },
  });
}

export async function createEmailTemplateCategoryFixture(createdById: string, name = `Category ${crypto.randomUUID().slice(0, 8)}`) {
  return testPrisma.emailTemplateCategory.create({ data: { name, createdById } });
}

export async function createPipelineStageFixture(
  name = `Stage ${crypto.randomUUID().slice(0, 8)}`,
  opts: { isDefault?: boolean; sortOrder?: number; outcomeType?: "WON" | "LOST" | null; active?: boolean } = {},
) {
  return testPrisma.pipelineStage.create({
    data: {
      name,
      isDefault: opts.isDefault ?? false,
      sortOrder: opts.sortOrder ?? 0,
      outcomeType: opts.outcomeType ?? null,
      active: opts.active ?? true,
    },
  });
}

export async function createRejectionReasonFixture(name = `Reason ${crypto.randomUUID().slice(0, 8)}`) {
  return testPrisma.rejectionReason.create({ data: { name } });
}

export async function createCompetitorFixture(name = `Competitor ${crypto.randomUUID().slice(0, 8)}`) {
  return testPrisma.competitor.create({ data: { name } });
}

export async function createCompanyFixture(opts: {
  name?: string;
  leadTypeId: string;
  pipelineStageId: string;
  assignedToId: string | null;
  createdById: string;
  competitorId?: string | null;
  status?: "ACTIVE" | "ARCHIVED";
  source?: "MANUAL" | "AI_RESEARCH" | "IMPORT" | null;
  importBatchId?: string | null;
  city?: string;
  region?: string;
  country?: string;
  email?: string | null;
  eosScore?: number | null;
  triviaStatus?: "CURRENT_TRIVIA" | "NO_CURRENT_TRIVIA" | "UNCERTAIN";
  createdAt?: Date;
}) {
  const name = opts.name ?? `Company ${crypto.randomUUID().slice(0, 8)}`;
  const city = opts.city ?? "Testville";
  const region = opts.region ?? "ON";
  const country = opts.country ?? "Canada";
  // Real companies always get these set at creation time (see
  // review/actions.ts#createCompany, companies/actions.ts) — without them,
  // scoreCompanyMatch()'s city/region corroboration signal (both matched-
  // AND conflicting-field branches) can never fire for a fixture company,
  // silently making city-conflict-dependent test assertions untestable.
  const { normalizedCity, normalizedRegion, normalizedPostalCode } = computeAddressNormalizedFields({ city, region, country, postalCode: null });

  const company = await testPrisma.company.create({
    data: {
      name,
      normalizedName: name.toLowerCase(),
      city,
      region,
      country,
      normalizedCity,
      normalizedRegion,
      normalizedPostalCode,
      email: opts.email ?? null,
      leadTypeId: opts.leadTypeId,
      pipelineStageId: opts.pipelineStageId,
      assignedToId: opts.assignedToId,
      createdById: opts.createdById,
      competitorId: opts.competitorId ?? null,
      status: opts.status ?? "ACTIVE",
      source: opts.source ?? null,
      importBatchId: opts.importBatchId ?? null,
      eosScore: opts.eosScore ?? null,
      triviaStatus: opts.triviaStatus ?? "UNCERTAIN",
    },
  });

  // createdAt has a DB default of now() with no updatable column exposed on
  // create — a direct update is the only way fixtures can backdate a
  // company for date-range tests.
  if (opts.createdAt) {
    return testPrisma.company.update({ where: { id: company.id }, data: { createdAt: opts.createdAt } });
  }
  return company;
}

export async function createPipelineStageHistoryFixture(opts: {
  companyId: string;
  changedById: string;
  fromStageId?: string | null;
  toStageId: string;
  changedAt?: Date;
  lossReasonId?: string | null;
}) {
  return testPrisma.pipelineStageHistory.create({
    data: {
      companyId: opts.companyId,
      changedById: opts.changedById,
      fromStageId: opts.fromStageId ?? null,
      toStageId: opts.toStageId,
      changedAt: opts.changedAt ?? new Date(),
      lossReasonId: opts.lossReasonId ?? null,
    },
  });
}

export async function createPromptTemplateFixture(opts: {
  createdById: string;
  name?: string;
  qualificationPrompt?: string;
  archived?: boolean;
}) {
  return testPrisma.promptTemplate.create({
    data: {
      name: opts.name ?? `Prompt ${crypto.randomUUID().slice(0, 8)}`,
      qualificationPrompt: opts.qualificationPrompt ?? "Independently-owned bars with a weekly events calendar.",
      archived: opts.archived ?? false,
      createdById: opts.createdById,
    },
  });
}

export async function createLeadSearchFixture(opts: {
  createdById: string;
  leadTypeId: string;
  promptId?: string;
  competitorId?: string | null;
  country?: string;
  region?: string;
  cities?: string[];
  minimumScore?: number;
  mode?: "TRIVIA_GAP" | "TRIVIA_CONFIRMED" | "COMPETITOR" | "GENERAL";
  runCorrelationId?: string | null;
}) {
  return testPrisma.leadSearch.create({
    data: {
      createdById: opts.createdById,
      leadTypeId: opts.leadTypeId,
      promptId: opts.promptId ?? null,
      competitorId: opts.competitorId ?? null,
      country: opts.country ?? "Canada",
      region: opts.region ?? "ON",
      cities: opts.cities ?? [],
      minimumScore: opts.minimumScore ?? 80,
      mode: opts.mode ?? "GENERAL",
      promptSnapshot: "Independently-owned bars with a weekly events calendar.",
      runCorrelationId: opts.runCorrelationId ?? null,
    },
  });
}

export async function createSearchResultFixture(opts: {
  searchId: string;
  name?: string;
  city?: string;
  region?: string;
  country?: string;
  address1?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  websiteUrl?: string | null;
  score?: number;
  explanation?: string;
  disposition?: "NEW" | "REVIEWED" | "TRANSFERRED" | "REJECTED" | "BELOW_SCORE" | "DUPLICATE";
  rejectionReasonId?: string | null;
  triviaStatus?: "CURRENT_TRIVIA" | "NO_CURRENT_TRIVIA" | "UNCERTAIN";
  competitorId?: string | null;
  contactData?: object | null;
  duplicateMatches?: object | null;
  duplicateConfidence?: "HIGH" | "MEDIUM" | "LOW" | null;
  competitorConflict?: boolean;
}) {
  const name = opts.name ?? `Result ${crypto.randomUUID().slice(0, 8)}`;
  const normalized = computeNormalizedFields({
    name,
    phone: opts.phone ?? null,
    email: opts.email ?? null,
    websiteUrl: opts.websiteUrl ?? null,
  });

  return testPrisma.searchResult.create({
    data: {
      searchId: opts.searchId,
      name,
      ...normalized,
      city: opts.city ?? "Milton",
      region: opts.region ?? "ON",
      country: opts.country ?? "Canada",
      address1: opts.address1 ?? null,
      postalCode: opts.postalCode ?? null,
      phone: opts.phone ?? null,
      email: opts.email ?? null,
      websiteUrl: opts.websiteUrl ?? null,
      score: opts.score ?? 80,
      explanation: opts.explanation ?? "Fixture explanation.",
      evidence: [],
      sources: [],
      disposition: opts.disposition ?? "NEW",
      rejectionReasonId: opts.rejectionReasonId ?? null,
      triviaStatus: opts.triviaStatus ?? "UNCERTAIN",
      competitorId: opts.competitorId ?? null,
      contactData: opts.contactData ?? undefined,
      duplicateMatches: opts.duplicateMatches ?? undefined,
      duplicateConfidence: opts.duplicateConfidence ?? null,
      competitorConflict: opts.competitorConflict ?? false,
    },
  });
}

export async function createImportTemplateFixture(opts: { createdById: string; name?: string; mapping?: object }) {
  return testPrisma.importTemplate.create({
    data: {
      name: opts.name ?? `Import Template ${crypto.randomUUID().slice(0, 8)}`,
      mapping: opts.mapping ?? {},
      createdById: opts.createdById,
    },
  });
}

/** Re-fetches a user with the role/permissions include shape
 * AuthenticatedUser requires — for tests that call a report-query function
 * directly (bypassing requireUser()'s own fetch), so the fixture user has
 * the same nested shape hasPermission()/reportScope() expect. */
export async function fetchAuthenticatedUser(userId: string) {
  return testPrisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { permissions: { include: { permission: true } } } }, team: true },
  });
}

/** Simulates a logged-in request by creating a real Session row and
 * writing its token into the mocked cookie jar (see tests/setup/mock-next.ts) —
 * exercises the real session-verification code path, not a stub. */
export async function loginAs(userId: string) {
  await createSession(userId);
}
