import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture } from "../helpers/fixtures";
import { runDataQualityScan } from "../../src/lib/data-quality/scan";

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

async function requiredPhoneRule(admin: { id: string }) {
  return testPrisma.dataQualityRule.create({
    data: { name: "Company missing phone", entityType: "COMPANY", field: "phone", ruleType: "REQUIRED_FIELD", severity: "MEDIUM", enabled: true, createdById: admin.id },
  });
}

describe("runDataQualityScan — issue detection", () => {
  it("creates an OPEN issue for a violating record and none for a passing one", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await requiredPhoneRule(admin);
    const missingPhone = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
    const hasPhone = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
    await testPrisma.company.update({ where: { id: hasPhone.id }, data: { phone: "9055550134" } });

    const scan = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan.id);

    const issues = await testPrisma.dataQualityIssue.findMany({ where: { companyId: { in: [missingPhone.id, hasPhone.id] } } });
    expect(issues).toHaveLength(1);
    expect(issues[0].companyId).toBe(missingPhone.id);
    expect(issues[0].status).toBe("OPEN");

    const finishedScan = await testPrisma.dataQualityScan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(finishedScan.status).toBe("SUCCEEDED");
    expect(finishedScan.recordsScanned).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent — re-running the scan never duplicates an open issue", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await requiredPhoneRule(admin);
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });

    const scan1 = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan1.id);
    const scan2 = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan2.id);

    expect(await testPrisma.dataQualityIssue.count()).toBe(1);
  });

  it("auto-resolves an issue once the record no longer violates the rule", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await requiredPhoneRule(admin);
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });

    const scan1 = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan1.id);
    expect((await testPrisma.dataQualityIssue.findFirstOrThrow({ where: { companyId: company.id } })).status).toBe("OPEN");

    await testPrisma.company.update({ where: { id: company.id }, data: { phone: "9055550134" } });

    const scan2 = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan2.id);

    const issue = await testPrisma.dataQualityIssue.findFirstOrThrow({ where: { companyId: company.id } });
    expect(issue.status).toBe("RESOLVED");
  });

  it("excludes archived and merged companies from scanning", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await requiredPhoneRule(admin);
    const archived = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, status: "ARCHIVED" });

    const scan = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan.id);

    expect(await testPrisma.dataQualityIssue.count({ where: { companyId: archived.id } })).toBe(0);
  });
});

describe("runDataQualityScan — duplicate detection", () => {
  it("flags two companies with the same normalized name as a potential duplicate", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await testPrisma.dataQualityRule.create({
      data: { name: "Dup normalized", entityType: "COMPANY", field: "name", ruleType: "DUPLICATE_NORMALIZED_MATCH", severity: "HIGH", enabled: true, createdById: admin.id },
    });
    const a = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "The Copper Kettle" });
    const b = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "the copper kettle" });

    const scan = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan.id);

    const pair = await testPrisma.potentialDuplicate.findFirst({ where: { entityType: "COMPANY" } });
    expect(pair).not.toBeNull();
    expect([pair!.companyAId, pair!.companyBId].sort()).toEqual([a.id, b.id].sort());
    expect(pair!.status).toBe("PENDING");
  });

  it("remembers a 'Not a duplicate' decision and doesn't re-suggest an unchanged pair", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await testPrisma.dataQualityRule.create({
      data: { name: "Dup normalized", entityType: "COMPANY", field: "name", ruleType: "DUPLICATE_NORMALIZED_MATCH", severity: "HIGH", enabled: true, createdById: admin.id },
    });
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "The Copper Kettle" });
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "the copper kettle" });

    const scan1 = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan1.id);

    const pair = await testPrisma.potentialDuplicate.findFirstOrThrow({ where: { entityType: "COMPANY" } });
    await testPrisma.potentialDuplicate.update({
      where: { id: pair.id },
      data: { status: "NOT_DUPLICATE", dismissedFieldsSnapshot: { name: "the copper kettle" } },
    });

    const scan2 = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan2.id);

    const stillDismissed = await testPrisma.potentialDuplicate.findUniqueOrThrow({ where: { id: pair.id } });
    expect(stillDismissed.status).toBe("NOT_DUPLICATE");
  });

  it("reconsiders a dismissed pair once a matched field meaningfully changes", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await testPrisma.dataQualityRule.create({
      data: { name: "Dup normalized", entityType: "COMPANY", field: "name", ruleType: "DUPLICATE_NORMALIZED_MATCH", severity: "HIGH", enabled: true, createdById: admin.id },
    });
    const a = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "The Copper Kettle" });
    const b = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "the copper kettle" });

    const scan1 = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan1.id);
    const pair = await testPrisma.potentialDuplicate.findFirstOrThrow({ where: { entityType: "COMPANY" } });
    await testPrisma.potentialDuplicate.update({ where: { id: pair.id }, data: { status: "NOT_DUPLICATE", dismissedFieldsSnapshot: { name: "the copper kettle", email: null, phone: null, websiteDomain: null } } });

    // A meaningful change to the matched field (name) should cause
    // reconsideration.
    await testPrisma.company.update({ where: { id: b.id }, data: { normalizedName: "totally different name" } });
    await testPrisma.company.update({ where: { id: a.id }, data: { normalizedName: "totally different name" } });

    const scan2 = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan2.id);

    const reconsidered = await testPrisma.potentialDuplicate.findUniqueOrThrow({ where: { id: pair.id } });
    expect(reconsidered.status).toBe("PENDING");
  });
});

describe("runDataQualityScan — resumption", () => {
  it("resumes the per-record issue scan from lastProcessedCompanyId rather than restarting", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await requiredPhoneRule(admin);
    const skipped = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
    const scanned = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });

    // Simulate a scan that already got partway through — its cursor is
    // past `skipped` (ids sort ascending: whichever was created first sorts
    // first, so we point the cursor at the lexicographically smaller id).
    const [firstId, secondId] = [skipped.id, scanned.id].sort();
    const scan = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id, lastProcessedCompanyId: firstId } });

    await runDataQualityScan(scan.id);

    const bySecondId = secondId === skipped.id ? skipped : scanned;
    const byFirstId = firstId === skipped.id ? skipped : scanned;

    // Only the company after the cursor should have been evaluated.
    expect(await testPrisma.dataQualityIssue.count({ where: { companyId: byFirstId.id } })).toBe(0);
    expect(await testPrisma.dataQualityIssue.count({ where: { companyId: bySecondId.id } })).toBe(1);
  });
});

describe("runDataQualityScan — cancellation", () => {
  it("stops early and marks the scan CANCELLED when isCancelled reports true", async () => {
    const { admin, leadType, stage } = await baseFixtures();
    await requiredPhoneRule(admin);
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });

    const scan = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
    await runDataQualityScan(scan.id, { isCancelled: async () => true });

    const result = await testPrisma.dataQualityScan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(result.status).toBe("CANCELLED");
  });

  it("does nothing if the scan row was already cancelled before it started", async () => {
    const { admin } = await baseFixtures();
    const scan = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id, status: "CANCELLED" } });
    await runDataQualityScan(scan.id);
    const result = await testPrisma.dataQualityScan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(result.status).toBe("CANCELLED");
  });
});
