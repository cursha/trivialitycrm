import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { analyzeCompanyOpportunity } from "../../src/app/(dashboard)/companies/opportunity-analysis";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function createAdminFixture() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "run_research", "bulk_update_leads", "edit_leads"]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  return { admin, leadType, stage };
}

async function createCompanyForAdmin(
  admin: { admin: Awaited<ReturnType<typeof createTestUser>>; leadType: Awaited<ReturnType<typeof createLeadTypeFixture>>; stage: Awaited<ReturnType<typeof createPipelineStageFixture>> },
  overrides: { email?: string | null; notes?: string | null } = {},
) {
  const company = await createCompanyFixture({
    leadTypeId: admin.leadType.id,
    pipelineStageId: admin.stage.id,
    assignedToId: admin.admin.id,
    createdById: admin.admin.id,
  });
  if (overrides.email !== undefined || overrides.notes !== undefined) {
    await testPrisma.company.update({ where: { id: company.id }, data: { email: overrides.email, notes: overrides.notes } });
  }
  return testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
}

async function baseFixtures(overrides: { email?: string | null; notes?: string | null } = {}) {
  const admin = await createAdminFixture();
  const company = await createCompanyForAdmin(admin, overrides);
  return { admin: admin.admin, leadType: admin.leadType, stage: admin.stage, company };
}

describe("analyzeCompanyOpportunity", () => {
  it("creates a HistoricalScoreRecord tagged as AI-sourced and repoints the Company's current score", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    const outcome = await analyzeCompanyOpportunity(company.id);
    expect("error" in outcome).toBe(false);

    const history = await testPrisma.historicalScoreRecord.findMany({ where: { companyId: company.id } });
    expect(history).toHaveLength(1);
    expect(history[0].scoringSource).toBe("anthropic-opportunity-analysis");
    expect(history[0].scoredById).toBeNull();

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.currentHistoricalScoreId).toBe(history[0].id);
    expect(updated.eosScore).toBe(history[0].eosTotal);
    expect(updated.opportunityGrade).toBe(history[0].opportunityGrade);
  });

  it("records one EvidenceRecord per evidence entry the provider returns", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    await analyzeCompanyOpportunity(company.id);

    const evidence = await testPrisma.evidenceRecord.findMany({ where: { companyId: company.id } });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].createdById).toBe(admin.id);
  });

  it("fills a blank email but never overwrites an existing one", async () => {
    const adminFixture = await createAdminFixture();
    await loginAs(adminFixture.admin.id);

    const withoutEmail = await createCompanyForAdmin(adminFixture, { email: null });
    await analyzeCompanyOpportunity(withoutEmail.id);
    const filledCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: withoutEmail.id } });
    expect(filledCompany.email).not.toBeNull();

    const withEmail = await createCompanyForAdmin(adminFixture, { email: "owner@example.test" });
    await analyzeCompanyOpportunity(withEmail.id);
    const untouchedCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: withEmail.id } });
    expect(untouchedCompany.email).toBe("owner@example.test");
  });

  it("sets needsReview only when the analysis reports a conflict, and never clears it automatically", async () => {
    const adminFixture = await createAdminFixture();
    await loginAs(adminFixture.admin.id);

    const normal = await createCompanyForAdmin(adminFixture);
    await analyzeCompanyOpportunity(normal.id);
    const normalAfter = await testPrisma.company.findUniqueOrThrow({ where: { id: normal.id } });
    expect(normalAfter.needsReview).toBe(false);

    const conflicted = await createCompanyForAdmin(adminFixture, { notes: "MOCK_CONFLICT" });
    const outcome = await analyzeCompanyOpportunity(conflicted.id);
    expect("error" in outcome).toBe(false);
    if (!("error" in outcome)) {
      expect(outcome.needsReview).toBe(true);
    }
    const conflictedAfter = await testPrisma.company.findUniqueOrThrow({ where: { id: conflicted.id } });
    expect(conflictedAfter.needsReview).toBe(true);
    expect(conflictedAfter.needsReviewReason).toBeTruthy();
  });

  it("requires edit_leads, run_research, and bulk_update_leads", async () => {
    const role = await createRoleWithPermissions("Limited", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
    await loginAs(user.id);

    await expect(analyzeCompanyOpportunity(company.id)).rejects.toThrow();
  });

  it("denies access to a company outside the user's scope", async () => {
    const roleA = await createRoleWithPermissions("TeamA", ["view_assigned_leads", "run_research", "bulk_update_leads", "edit_leads"]);
    const userA = await createTestUser({ roleId: roleA.id });
    const roleB = await createRoleWithPermissions("TeamB", ["view_assigned_leads", "run_research", "bulk_update_leads", "edit_leads"]);
    const userB = await createTestUser({ roleId: roleB.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: userA.id, createdById: userA.id });

    await loginAs(userB.id);
    const outcome = await analyzeCompanyOpportunity(company.id);
    expect("error" in outcome).toBe(true);
    expect(await testPrisma.historicalScoreRecord.count({ where: { companyId: company.id } })).toBe(0);
  });
});
