import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture } from "../helpers/fixtures";
import { mergeCompanies, CompanyMergeError, resolveSurvivingCompanyId } from "../../src/lib/data-quality/merge-company";

beforeEach(async () => {
  await resetDatabase();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "edit_leads"]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  return { admin, leadType, stage };
}

async function twoCompanies() {
  const { admin, leadType, stage } = await baseFixtures();
  const surviving = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "Surviving Co" });
  const merged = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "Merged Co" });
  return { admin, leadType, stage, surviving, merged };
}

describe("mergeCompanies", () => {
  it("reassigns every related record type onto the surviving company", async () => {
    const { admin, surviving, merged } = await twoCompanies();

    const contact = await testPrisma.contact.create({ data: { companyId: merged.id, firstName: "Jane", lastName: "Doe" } });
    await testPrisma.activity.create({ data: { companyId: merged.id, userId: admin.id, type: "NOTE", notes: "hello" } });
    const task = await testPrisma.task.create({ data: { companyId: merged.id, assignedToId: admin.id, title: "Follow up", dueAt: new Date() } });
    const evidence = await testPrisma.evidenceRecord.create({
      data: { companyId: merged.id, category: "FOOD_BEVERAGE_FOCUS", evidenceSummary: "evidence", createdById: admin.id },
    });
    const source = await testPrisma.companySource.create({ data: { companyId: merged.id, url: "https://example.com", verifiedAt: new Date() } });

    await mergeCompanies({ survivingCompanyId: surviving.id, mergedCompanyId: merged.id, fieldDecisions: {}, actorId: admin.id });

    expect((await testPrisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).companyId).toBe(surviving.id);
    expect(await testPrisma.activity.count({ where: { companyId: surviving.id } })).toBeGreaterThanOrEqual(1);
    expect((await testPrisma.task.findUniqueOrThrow({ where: { id: task.id } })).companyId).toBe(surviving.id);
    expect((await testPrisma.evidenceRecord.findUniqueOrThrow({ where: { id: evidence.id } })).companyId).toBe(surviving.id);
    expect((await testPrisma.companySource.findUniqueOrThrow({ where: { id: source.id } })).companyId).toBe(surviving.id);

    const tombstoned = await testPrisma.company.findUniqueOrThrow({ where: { id: merged.id } });
    expect(tombstoned.status).toBe("MERGED");
    expect(tombstoned.mergedIntoId).toBe(surviving.id);
    expect(tombstoned.mergedById).toBe(admin.id);
    expect(tombstoned.mergedAt).not.toBeNull();
    // Never overwrites the merged company's own historical fields.
    expect(tombstoned.name).toBe("Merged Co");
  });

  it("applies field decisions to the surviving company and writes an Activity + audit event", async () => {
    const { admin, surviving, merged } = await twoCompanies();

    await mergeCompanies({ survivingCompanyId: surviving.id, mergedCompanyId: merged.id, fieldDecisions: { phone: "9055550134" }, actorId: admin.id });

    const updatedSurvivor = await testPrisma.company.findUniqueOrThrow({ where: { id: surviving.id } });
    expect(updatedSurvivor.phone).toBe("9055550134");

    const activity = await testPrisma.activity.findFirst({ where: { companyId: surviving.id, type: "COMPANY_MERGED" } });
    expect(activity).not.toBeNull();

    const auditEvent = await testPrisma.dataQualityAuditEvent.findFirst({ where: { action: "COMPANY_MERGED", companyId: surviving.id } });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.beforeData).not.toBeNull();
    expect(auditEvent?.afterData).not.toBeNull();
  });

  it("prevents merging a company into itself", async () => {
    const { admin, surviving } = await twoCompanies();
    await expect(mergeCompanies({ survivingCompanyId: surviving.id, mergedCompanyId: surviving.id, fieldDecisions: {}, actorId: admin.id })).rejects.toThrow(CompanyMergeError);
  });

  it("prevents merging an already-merged company again (no repeated merges)", async () => {
    const { admin, leadType, stage, surviving, merged } = await twoCompanies();
    const third = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "Third Co" });

    await mergeCompanies({ survivingCompanyId: surviving.id, mergedCompanyId: merged.id, fieldDecisions: {}, actorId: admin.id });

    await expect(mergeCompanies({ survivingCompanyId: third.id, mergedCompanyId: merged.id, fieldDecisions: {}, actorId: admin.id })).rejects.toThrow(/already been merged/);
  });

  it("rolls back the whole transaction if any step fails (no partial merge)", async () => {
    const { admin, merged } = await twoCompanies();
    const contact = await testPrisma.contact.create({ data: { companyId: merged.id, firstName: "Jane", lastName: "Doe" } });

    // A non-existent surviving id forces a failure inside the transaction.
    await expect(mergeCompanies({ survivingCompanyId: "does-not-exist", mergedCompanyId: merged.id, fieldDecisions: {}, actorId: admin.id })).rejects.toThrow();

    // Nothing should have moved or changed.
    const stillOnMerged = await testPrisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(stillOnMerged.companyId).toBe(merged.id);
    const mergedCompanyStillActive = await testPrisma.company.findUniqueOrThrow({ where: { id: merged.id } });
    expect(mergedCompanyStillActive.status).toBe("ACTIVE");
  });

  it("keeps the surviving company's current EOS score by default", async () => {
    const { admin, surviving, merged } = await twoCompanies();

    const survivorScore = await testPrisma.historicalScoreRecord.create({
      data: {
        companyId: surviving.id,
        eosTotal: 90,
        foodBeverageFocus: 9, weeknightRevenueOpportunity: 9, communityEngagement: 9, existingEventCulture: 9, groupSeatingLayout: 9,
        capacityOperationalSuitability: 9, decisionMakerAccessibility: 9, marketingActivityVisibility: 9, turnkeyImplementationReadiness: 9, competitiveOpportunity: 9,
        opportunityGrade: "A", confidenceLevel: "HIGH", primaryClassification: "GREENFIELD", scoringVersion: "v1", scoredById: admin.id,
      },
    });
    await testPrisma.company.update({ where: { id: surviving.id }, data: { currentHistoricalScoreId: survivorScore.id, eosScore: 90 } });

    const mergedScore = await testPrisma.historicalScoreRecord.create({
      data: {
        companyId: merged.id,
        eosTotal: 50,
        foodBeverageFocus: 5, weeknightRevenueOpportunity: 5, communityEngagement: 5, existingEventCulture: 5, groupSeatingLayout: 5,
        capacityOperationalSuitability: 5, decisionMakerAccessibility: 5, marketingActivityVisibility: 5, turnkeyImplementationReadiness: 5, competitiveOpportunity: 5,
        opportunityGrade: "C", confidenceLevel: "LOW", primaryClassification: "NEEDS_QUALIFICATION", scoringVersion: "v1", scoredById: admin.id,
      },
    });
    await testPrisma.company.update({ where: { id: merged.id }, data: { currentHistoricalScoreId: mergedScore.id, eosScore: 50 } });

    await mergeCompanies({ survivingCompanyId: surviving.id, mergedCompanyId: merged.id, fieldDecisions: {}, eosChoice: "surviving", actorId: admin.id });

    const result = await testPrisma.company.findUniqueOrThrow({ where: { id: surviving.id } });
    expect(result.eosScore).toBe(90);
    expect(result.currentHistoricalScoreId).toBe(survivorScore.id);

    // Both history rows preserved, reassigned onto the survivor.
    const history = await testPrisma.historicalScoreRecord.findMany({ where: { companyId: surviving.id } });
    expect(history.map((h) => h.id).sort()).toEqual([survivorScore.id, mergedScore.id].sort());
  });

  it("adopts the merged company's current EOS score when eosChoice is 'merged'", async () => {
    const { admin, surviving, merged } = await twoCompanies();

    const mergedScore = await testPrisma.historicalScoreRecord.create({
      data: {
        companyId: merged.id,
        eosTotal: 75,
        foodBeverageFocus: 7, weeknightRevenueOpportunity: 7, communityEngagement: 7, existingEventCulture: 7, groupSeatingLayout: 7,
        capacityOperationalSuitability: 7, decisionMakerAccessibility: 7, marketingActivityVisibility: 7, turnkeyImplementationReadiness: 7, competitiveOpportunity: 7,
        opportunityGrade: "B", confidenceLevel: "MEDIUM", primaryClassification: "GREENFIELD", scoringVersion: "v1", scoredById: admin.id,
      },
    });
    await testPrisma.company.update({ where: { id: merged.id }, data: { currentHistoricalScoreId: mergedScore.id, eosScore: 75 } });

    await mergeCompanies({ survivingCompanyId: surviving.id, mergedCompanyId: merged.id, fieldDecisions: {}, eosChoice: "merged", actorId: admin.id });

    const result = await testPrisma.company.findUniqueOrThrow({ where: { id: surviving.id } });
    expect(result.eosScore).toBe(75);
    expect(result.currentHistoricalScoreId).toBe(mergedScore.id);
  });

  it("cancels a duplicate active sequence enrollment left after reassignment instead of leaving two active in the same sequence", async () => {
    const { admin, leadType, stage, surviving, merged } = await twoCompanies();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Seq", createdById: admin.id } });

    const survivorEnrollment = await testPrisma.sequenceEnrollment.create({
      data: { sequenceId: sequence.id, companyId: surviving.id, status: "ACTIVE", currentStepOrder: 1, enrolledById: admin.id, enrolledAt: new Date("2024-01-01") },
    });
    const mergedEnrollment = await testPrisma.sequenceEnrollment.create({
      data: { sequenceId: sequence.id, companyId: merged.id, status: "ACTIVE", currentStepOrder: 1, enrolledById: admin.id, enrolledAt: new Date("2024-06-01") },
    });
    void leadType;
    void stage;

    await mergeCompanies({ survivingCompanyId: surviving.id, mergedCompanyId: merged.id, fieldDecisions: {}, actorId: admin.id });

    const survivorAfter = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: survivorEnrollment.id } });
    const mergedAfter = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: mergedEnrollment.id } });

    // Most-recently-enrolled (mergedEnrollment, 2024-06-01) stays active;
    // the older one is cancelled with a clear reason.
    expect(mergedAfter.companyId).toBe(surviving.id);
    expect(mergedAfter.status).toBe("ACTIVE");
    expect(survivorAfter.status).toBe("CANCELLED");
    expect(survivorAfter.stopReason).toMatch(/merge/i);
  });
});

describe("resolveSurvivingCompanyId", () => {
  it("resolves a chained merge to its final survivor", async () => {
    const { admin, leadType, stage, surviving, merged } = await twoCompanies();
    const third = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "Third Co" });

    await mergeCompanies({ survivingCompanyId: surviving.id, mergedCompanyId: merged.id, fieldDecisions: {}, actorId: admin.id });
    await mergeCompanies({ survivingCompanyId: third.id, mergedCompanyId: surviving.id, fieldDecisions: {}, actorId: admin.id });

    expect(await resolveSurvivingCompanyId(merged.id)).toBe(third.id);
    expect(await resolveSurvivingCompanyId(surviving.id)).toBe(third.id);
    expect(await resolveSurvivingCompanyId(third.id)).toBe(third.id);
  });
});
