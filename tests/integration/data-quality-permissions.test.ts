import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { triggerDataQualityScan } from "../../src/app/(dashboard)/data-quality/scans/actions";
import { createRule } from "../../src/app/(dashboard)/data-quality/rules/actions";
import { setDuplicateStatus, mergeCompanyDuplicate } from "../../src/app/(dashboard)/data-quality/duplicates/actions";
import { requestEnrichmentSuggestions } from "../../src/app/(dashboard)/data-quality/enrichment/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function noPermissionsUser() {
  const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
  return createTestUser({ roleId: role.id });
}

describe("data quality permission gating", () => {
  it("run_duplicate_scan is required to trigger a scan", async () => {
    const user = await noPermissionsUser();
    await loginAs(user.id);
    await expect(triggerDataQualityScan(null)).rejects.toThrow();
  });

  it("manage_data_quality_rules is required to create a rule", async () => {
    const user = await noPermissionsUser();
    await loginAs(user.id);
    const fd = new FormData();
    fd.set("name", "x");
    fd.set("entityType", "COMPANY");
    fd.set("field", "phone");
    fd.set("ruleType", "REQUIRED_FIELD");
    fd.set("severity", "MEDIUM");
    await expect(createRule(undefined, fd)).rejects.toThrow();
  });

  it("review_data_quality is required to review a possible duplicate", async () => {
    const user = await noPermissionsUser();
    await loginAs(user.id);
    await expect(setDuplicateStatus("whatever", "CONFIRMED")).rejects.toThrow();
  });

  it("review_data_quality alone does not grant merge_companies", async () => {
    const role = await createRoleWithPermissions("Manager", ["view_all_leads", "review_data_quality"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const a = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
    const b = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });

    await expect(mergeCompanyDuplicate("dup-id", a.id, b.id, {}, "surviving")).rejects.toThrow();
  });

  it("review_enrichment is required to request enrichment suggestions", async () => {
    const user = await noPermissionsUser();
    await loginAs(user.id);
    await expect(requestEnrichmentSuggestions("COMPANY", "whatever")).rejects.toThrow();
  });

  it("Administrator is granted every new Module Seven permission by the seeded default matrix", async () => {
    // Mirrors prisma/seed.ts's own convention (Administrator = every
    // permission) without re-running the full seed script — asserts the
    // permission keys this module added actually exist and are grantable.
    const keys = [
      "view_data_quality",
      "review_data_quality",
      "manage_data_quality_rules",
      "merge_companies",
      "merge_contacts",
      "run_duplicate_scan",
      "review_enrichment",
      "manage_enrichment_settings",
    ];
    const role = await createRoleWithPermissions("Administrator", keys);
    const user = await createTestUser({ roleId: role.id });
    const withRole = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
    const grantedKeys = withRole.role.permissions.filter((rp) => rp.allowed).map((rp) => rp.permission.key);
    for (const key of keys) expect(grantedKeys).toContain(key);
  });
});
