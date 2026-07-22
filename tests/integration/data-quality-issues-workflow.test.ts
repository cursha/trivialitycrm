import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { setIssueStatus, assignIssue, bulkUpdateIssues, correctIssueField } from "../../src/app/(dashboard)/data-quality/issues/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "edit_leads", "review_data_quality"]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
  const rule = await testPrisma.dataQualityRule.create({
    data: { name: "Missing phone", entityType: "COMPANY", field: "phone", ruleType: "REQUIRED_FIELD", severity: "MEDIUM", enabled: true, createdById: admin.id },
  });
  const issue = await testPrisma.dataQualityIssue.create({
    data: { entityType: "COMPANY", companyId: company.id, ruleId: rule.id, field: "phone", severity: "MEDIUM", description: "Phone is missing." },
  });
  return { admin, company, rule, issue };
}

describe("data quality issue lifecycle", () => {
  it("requires review_data_quality to change issue status", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(setIssueStatus("whatever", "DEFERRED")).rejects.toThrow();
  });

  it("moves an issue through OPEN -> DEFERRED -> REOPENED", async () => {
    const { admin, issue } = await baseFixtures();
    await loginAs(admin.id);

    await setIssueStatus(issue.id, "DEFERRED");
    expect((await testPrisma.dataQualityIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("DEFERRED");

    await setIssueStatus(issue.id, "REOPENED");
    expect((await testPrisma.dataQualityIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("REOPENED");
  });

  it("ignoring an issue stamps resolvedAt/resolvedById", async () => {
    const { admin, issue } = await baseFixtures();
    await loginAs(admin.id);

    await setIssueStatus(issue.id, "IGNORED");
    const result = await testPrisma.dataQualityIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(result.status).toBe("IGNORED");
    expect(result.resolvedById).toBe(admin.id);
    expect(result.resolvedAt).not.toBeNull();
  });

  it("assigns an issue to a reviewer", async () => {
    const { admin, issue } = await baseFixtures();
    const reviewerRole = await createRoleWithPermissions("Manager", ["view_team_leads"]);
    const reviewer = await createTestUser({ roleId: reviewerRole.id });
    await loginAs(admin.id);

    await assignIssue(issue.id, reviewer.id);
    expect((await testPrisma.dataQualityIssue.findUniqueOrThrow({ where: { id: issue.id } })).assignedToId).toBe(reviewer.id);
  });

  it("bulk-defers multiple issues at once, but merges/corrections stay individual (not exposed via bulkUpdateIssues)", async () => {
    const { admin, company, rule } = await baseFixtures();
    await loginAs(admin.id);

    const secondCompany = await testPrisma.company.create({
      data: { name: "Second Co", normalizedName: "second co", city: "Testville", region: "ON", country: "Canada", leadTypeId: (await testPrisma.leadType.findFirstOrThrow()).id, pipelineStageId: (await testPrisma.pipelineStage.findFirstOrThrow()).id, createdById: admin.id },
    });
    const secondIssue = await testPrisma.dataQualityIssue.create({
      data: { entityType: "COMPANY", companyId: secondCompany.id, ruleId: rule.id, field: "phone", severity: "MEDIUM", description: "Phone is missing." },
    });
    const firstIssue = await testPrisma.dataQualityIssue.findFirstOrThrow({ where: { companyId: company.id } });

    await bulkUpdateIssues([firstIssue.id, secondIssue.id], "defer");

    const results = await testPrisma.dataQualityIssue.findMany({ where: { id: { in: [firstIssue.id, secondIssue.id] } } });
    expect(results.every((r) => r.status === "DEFERRED")).toBe(true);
  });

  it("correcting a field resolves the issue once the record no longer violates the rule", async () => {
    const { admin, issue, company } = await baseFixtures();
    await loginAs(admin.id);

    const fd = new FormData();
    fd.set("value", "9055550134");
    await correctIssueField(issue.id, fd);

    const updatedCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.phone).toBe("9055550134");

    const updatedIssue = await testPrisma.dataQualityIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(updatedIssue.status).toBe("RESOLVED");
    expect(updatedIssue.resolutionAction).toBe("corrected");

    const auditEvent = await testPrisma.dataQualityAuditEvent.findFirst({ where: { action: "RECORD_CORRECTED", issueId: issue.id } });
    expect(auditEvent).not.toBeNull();
  });

  it("keeps the issue open if the correction doesn't actually fix the violation", async () => {
    const { admin, rule, company } = await baseFixtures();
    await loginAs(admin.id);

    const emailRule = await testPrisma.dataQualityRule.create({
      data: { name: "Invalid email", entityType: "COMPANY", field: "email", ruleType: "INVALID_EMAIL_FORMAT", severity: "HIGH", enabled: true, createdById: admin.id },
    });
    const emailIssue = await testPrisma.dataQualityIssue.create({
      data: { entityType: "COMPANY", companyId: company.id, ruleId: emailRule.id, field: "email", severity: "HIGH", description: "Bad email." },
    });
    void rule;

    const fd = new FormData();
    fd.set("value", "still-not-an-email");
    await correctIssueField(emailIssue.id, fd);

    const updatedIssue = await testPrisma.dataQualityIssue.findUniqueOrThrow({ where: { id: emailIssue.id } });
    expect(updatedIssue.status).toBe("OPEN");
  });
});
