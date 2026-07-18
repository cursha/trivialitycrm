import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompanyFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { recordHistoricalScore } from "../../src/app/(dashboard)/companies/[id]/eos/actions";
import {
  createPipelineStage,
  setDefaultPipelineStage,
  deletePipelineStage,
} from "../../src/app/(dashboard)/settings/pipeline-stages/actions";
import { activeProspectRankingWhere } from "../../src/lib/eos/validation";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", [
    "view_all_leads",
    "edit_leads",
    "manage_settings",
  ]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  const company = await createCompanyFixture({
    leadTypeId: leadType.id,
    pipelineStageId: stage.id,
    assignedToId: admin.id,
    createdById: admin.id,
  });
  return { admin, leadType, stage, company };
}

function scoreFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    foodBeverageFocus: "10",
    weeknightRevenueOpportunity: "10",
    communityEngagement: "5",
    existingEventCulture: "5",
    groupSeatingLayout: "5",
    capacityOperationalSuitability: "5",
    decisionMakerAccessibility: "5",
    marketingActivityVisibility: "5",
    turnkeyImplementationReadiness: "3",
    competitiveOpportunity: "2",
    confidenceLevel: "MEDIUM",
    primaryClassification: "GREENFIELD",
    scoringVersion: "manual-1.0",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(key, value);
  }
  return fd;
}

describe("EOS historical score preservation", () => {
  it("never overwrites a prior score — each save appends a new history row", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    await recordHistoricalScore(company.id, undefined, scoreFormData({ scoringVersion: "v1" }));
    await recordHistoricalScore(company.id, undefined, scoreFormData({ scoringVersion: "v2", foodBeverageFocus: "15" }));

    const history = await testPrisma.historicalScoreRecord.findMany({
      where: { companyId: company.id },
      orderBy: { scoredAt: "asc" },
    });

    expect(history).toHaveLength(2);
    expect(history[0].scoringVersion).toBe("v1");
    expect(history[1].scoringVersion).toBe("v2");
    // The first record's own values are untouched by the second save.
    expect(history[0].foodBeverageFocus).toBe(10);
  });

  it("repoints Company.currentHistoricalScoreId to the newest record, never leaving two current at once", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    await recordHistoricalScore(company.id, undefined, scoreFormData({ scoringVersion: "v1" }));
    const afterFirst = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    const firstPointer = afterFirst.currentHistoricalScoreId;
    expect(firstPointer).not.toBeNull();

    await recordHistoricalScore(company.id, undefined, scoreFormData({ scoringVersion: "v2" }));
    const afterSecond = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });

    expect(afterSecond.currentHistoricalScoreId).not.toBe(firstPointer);

    const secondRecord = await testPrisma.historicalScoreRecord.findFirstOrThrow({
      where: { companyId: company.id, scoringVersion: "v2" },
    });
    expect(afterSecond.currentHistoricalScoreId).toBe(secondRecord.id);

    // The @unique constraint on currentHistoricalScoreId means at most one
    // company can ever point at a given history row as current — confirm
    // no other company does.
    const otherPointers = await testPrisma.company.count({
      where: { currentHistoricalScoreId: secondRecord.id, NOT: { id: company.id } },
    });
    expect(otherPointers).toBe(0);
  });

  it("computes the grade and total from category scores, not from client input", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    // Categories sum to 100 — should grade A+ regardless of what a caller
    // might otherwise claim the total/grade to be.
    await recordHistoricalScore(
      company.id,
      undefined,
      scoreFormData({
        foodBeverageFocus: "15",
        weeknightRevenueOpportunity: "15",
        communityEngagement: "10",
        existingEventCulture: "10",
        groupSeatingLayout: "10",
        capacityOperationalSuitability: "10",
        decisionMakerAccessibility: "10",
        marketingActivityVisibility: "10",
        turnkeyImplementationReadiness: "5",
        competitiveOpportunity: "5",
      }),
    );

    const record = await testPrisma.historicalScoreRecord.findFirstOrThrow({ where: { companyId: company.id } });
    expect(record.eosTotal).toBe(100);
    expect(record.opportunityGrade).toBe("A_PLUS");

    const updatedCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.eosScore).toBe(100);
    expect(updatedCompany.opportunityGrade).toBe("A_PLUS");
  });

  it("rejects a category score above its maximum before writing anything", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    const result = await recordHistoricalScore(company.id, undefined, scoreFormData({ foodBeverageFocus: "20" }));

    // Rejected at the Zod schema layer (max(15)) before ever reaching
    // src/lib/eos/validation.ts's validateCategoryScores — that pure
    // function's own maxima checks are covered directly by
    // tests/unit/eos-validation.test.ts. This test only needs to confirm
    // the action refuses an out-of-range category and writes nothing.
    expect(result?.error).toBeTruthy();
    expect(await testPrisma.historicalScoreRecord.count({ where: { companyId: company.id } })).toBe(0);
  });
});

describe("active ranking exclusion", () => {
  it("excludes existing customers and do-not-contact companies from the active ranking filter", async () => {
    const { admin, leadType, stage } = await baseFixtures();

    const normalProspect = await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
    });
    const existingCustomer = await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
    });
    await testPrisma.company.update({ where: { id: existingCustomer.id }, data: { isExistingCustomer: true } });

    const doNotContact = await createCompanyFixture({
      leadTypeId: leadType.id,
      pipelineStageId: stage.id,
      assignedToId: admin.id,
      createdById: admin.id,
    });
    await testPrisma.company.update({ where: { id: doNotContact.id }, data: { doNotContact: true } });

    const activeRanking = await testPrisma.company.findMany({ where: activeProspectRankingWhere() });
    const names = activeRanking.map((c) => c.id);

    expect(names).toContain(normalProspect.id);
    expect(names).not.toContain(existingCustomer.id);
    expect(names).not.toContain(doNotContact.id);
  });
});

describe("pipeline stage default invariant", () => {
  it("keeps exactly one default stage as new ones are added and defaults are switched", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_settings"]);
    const admin = await createTestUser({ roleId: role.id });
    await loginAs(admin.id);

    const fd1 = new FormData();
    fd1.set("name", "New");
    await createPipelineStage(undefined, fd1);

    const fd2 = new FormData();
    fd2.set("name", "Demo Given");
    await createPipelineStage(undefined, fd2);

    let stages = await testPrisma.pipelineStage.findMany();
    expect(stages.filter((s) => s.isDefault)).toHaveLength(1);
    expect(stages.find((s) => s.isDefault)?.name).toBe("New");

    const demoStage = stages.find((s) => s.name === "Demo Given")!;
    await setDefaultPipelineStage(demoStage.id);

    stages = await testPrisma.pipelineStage.findMany();
    expect(stages.filter((s) => s.isDefault)).toHaveLength(1);
    expect(stages.find((s) => s.isDefault)?.name).toBe("Demo Given");
  });

  it("refuses to delete the current default stage", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_settings"]);
    const admin = await createTestUser({ roleId: role.id });
    await loginAs(admin.id);

    const fd = new FormData();
    fd.set("name", "New");
    await createPipelineStage(undefined, fd);

    const stage = await testPrisma.pipelineStage.findFirstOrThrow({ where: { name: "New" } });
    const result = await deletePipelineStage(stage.id);

    expect(result?.error).toMatch(/default stage/);
    expect(await testPrisma.pipelineStage.count()).toBe(1);
  });
});
