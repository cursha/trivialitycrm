import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { requestEnrichmentSuggestions, acceptEnrichmentSuggestion, rejectEnrichmentSuggestion } from "../../src/app/(dashboard)/data-quality/enrichment/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "edit_leads", "review_enrichment"]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "The Copper Kettle" });
  return { admin, company };
}

describe("enrichment suggestion workflow", () => {
  it("requires the review_enrichment permission", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(requestEnrichmentSuggestions("COMPANY", "whatever")).rejects.toThrow();
  });

  it("creates PENDING suggestions using only the mock provider, at zero cost", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    await requestEnrichmentSuggestions("COMPANY", company.id);

    const suggestions = await testPrisma.enrichmentRecord.findMany({ where: { companyId: company.id } });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.decision).toBe("PENDING");
      expect(s.provider).toBe("mock");
      expect(Number(s.estimatedCostUsd)).toBe(0);
    }
  });

  it("never applies a suggestion to the record until explicitly accepted", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    const before = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    await requestEnrichmentSuggestions("COMPANY", company.id);

    const after = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after.phone).toBe(before.phone);
    expect(after.websiteUrl).toBe(before.websiteUrl);
  });

  it("applies the suggested value to the record on accept, and records the decision", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    await requestEnrichmentSuggestions("COMPANY", company.id);
    const suggestion = await testPrisma.enrichmentRecord.findFirstOrThrow({ where: { companyId: company.id, field: "websiteUrl" } });

    await acceptEnrichmentSuggestion(suggestion.id);

    const updatedCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.websiteUrl).toBe(suggestion.suggestedValue);

    const decided = await testPrisma.enrichmentRecord.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(decided.decision).toBe("ACCEPTED");
    expect(decided.decidedById).toBe(admin.id);

    const auditEvent = await testPrisma.dataQualityAuditEvent.findFirst({ where: { action: "ENRICHMENT_ACCEPTED", enrichmentRecordId: suggestion.id } });
    expect(auditEvent).not.toBeNull();
  });

  it("keeps a rejected suggestion for audit rather than deleting it", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    await requestEnrichmentSuggestions("COMPANY", company.id);
    const suggestion = await testPrisma.enrichmentRecord.findFirstOrThrow({ where: { companyId: company.id } });

    await rejectEnrichmentSuggestion(suggestion.id);

    const decided = await testPrisma.enrichmentRecord.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(decided.decision).toBe("REJECTED");

    const updatedCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.websiteUrl).not.toBe(suggestion.suggestedValue);
  });

  it("refuses to decide an already-decided suggestion twice", async () => {
    const { admin, company } = await baseFixtures();
    await loginAs(admin.id);

    await requestEnrichmentSuggestions("COMPANY", company.id);
    const suggestion = await testPrisma.enrichmentRecord.findFirstOrThrow({ where: { companyId: company.id } });
    await acceptEnrichmentSuggestion(suggestion.id);

    const result = await rejectEnrichmentSuggestion(suggestion.id);
    expect(result?.error).toBeTruthy();
  });
});
