import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies, RedirectSignal } from "../setup/mock-next";
import { setDuplicateStatus, mergeCompanyDuplicate } from "../../src/app/(dashboard)/data-quality/duplicates/actions";
import { runDataQualityScan } from "../../src/lib/data-quality/scan";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function duplicatePairFixture() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "edit_leads", "review_data_quality", "merge_companies"]);
  const admin = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  await testPrisma.dataQualityRule.create({
    data: { name: "Dup normalized", entityType: "COMPANY", field: "name", ruleType: "DUPLICATE_NORMALIZED_MATCH", severity: "HIGH", enabled: true, createdById: admin.id },
  });
  const a = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "The Copper Kettle" });
  const b = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id, name: "the copper kettle" });

  const scan = await testPrisma.dataQualityScan.create({ data: { triggeredById: admin.id } });
  await runDataQualityScan(scan.id);
  const pair = await testPrisma.potentialDuplicate.findFirstOrThrow({ where: { entityType: "COMPANY" } });

  return { admin, a, b, pair };
}

describe("duplicate review + merge end-to-end", () => {
  it("marking a pair 'Not a duplicate' records a snapshot and reviewer", async () => {
    const { admin, pair } = await duplicatePairFixture();
    await loginAs(admin.id);

    await setDuplicateStatus(pair.id, "NOT_DUPLICATE", "Different locations of the same chain.");

    const updated = await testPrisma.potentialDuplicate.findUniqueOrThrow({ where: { id: pair.id } });
    expect(updated.status).toBe("NOT_DUPLICATE");
    expect(updated.reviewedById).toBe(admin.id);
    expect(updated.reviewNote).toMatch(/chain/);
    expect(updated.dismissedFieldsSnapshot).not.toBeNull();
  });

  it("merging from the review screen redirects to the surviving company and marks the pair MERGED", async () => {
    const { admin, a, b, pair } = await duplicatePairFixture();
    await loginAs(admin.id);

    let redirectUrl: string | undefined;
    try {
      await mergeCompanyDuplicate(pair.id, a.id, b.id, {}, "surviving");
      expect.fail("expected mergeCompanyDuplicate to redirect on success");
    } catch (error) {
      redirectUrl = (error as RedirectSignal).url;
    }

    expect(redirectUrl).toBe(`/companies/${a.id}`);

    const mergedPair = await testPrisma.potentialDuplicate.findUniqueOrThrow({ where: { id: pair.id } });
    expect(mergedPair.status).toBe("MERGED");

    const mergedCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: b.id } });
    expect(mergedCompany.status).toBe("MERGED");
    expect(mergedCompany.mergedIntoId).toBe(a.id);
  });
});
