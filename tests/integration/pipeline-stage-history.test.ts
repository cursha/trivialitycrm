import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompanyFixture,
  createRejectionReasonFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies, RedirectSignal } from "../setup/mock-next";
import { changeCompanyStage, createCompany, updateCompany } from "../../src/app/(dashboard)/companies/actions";
import { bulkChangeStage } from "../../src/app/(dashboard)/companies/bulk-actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function expectRedirect(promise: Promise<unknown>) {
  try {
    await promise;
    expect.fail("expected the action to redirect on success");
  } catch (error) {
    expect(error).toBeInstanceOf(RedirectSignal);
  }
}

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", [
    "view_all_leads",
    "add_leads",
    "edit_leads",
    "bulk_update_leads",
  ]);
  const user = await createTestUser({ name: "Admin", roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stageNew = await createPipelineStageFixture("New", { sortOrder: 0 });
  const stageDemo = await createPipelineStageFixture("Demo Given", { sortOrder: 1 });
  const stageLost = await createPipelineStageFixture("Lost", { sortOrder: 2, outcomeType: "LOST" });
  return { role, user, leadType, stageNew, stageDemo, stageLost };
}

describe("PipelineStageHistory writes", () => {
  it("writes an initial history row (fromStageId null) when a company is created", async () => {
    const { user, leadType, stageNew } = await baseFixtures();
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("name", "New Co");
    formData.set("city", "Milton");
    formData.set("region", "ON");
    formData.set("country", "Canada");
    formData.set("leadTypeId", leadType.id);
    formData.set("pipelineStageId", stageNew.id);
    formData.set("triviaStatus", "UNCERTAIN");
    formData.set("overrideDuplicates", "true");

    await expectRedirect(createCompany(undefined, formData));

    const company = await testPrisma.company.findFirstOrThrow({ where: { name: "New Co" } });
    expect(company.source).toBe("MANUAL");

    const history = await testPrisma.pipelineStageHistory.findMany({ where: { companyId: company.id } });
    expect(history).toHaveLength(1);
    expect(history[0].fromStageId).toBeNull();
    expect(history[0].toStageId).toBe(stageNew.id);
    expect(history[0].changedById).toBe(user.id);
  });

  it("writes one identical-shaped history row for a single stage-change edit (updateCompany)", async () => {
    const { user, leadType, stageNew, stageDemo } = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: user.id, createdById: user.id });
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("name", company.name);
    formData.set("city", company.city);
    formData.set("region", company.region);
    formData.set("country", company.country);
    formData.set("leadTypeId", leadType.id);
    formData.set("pipelineStageId", stageDemo.id);
    formData.set("assignedToId", user.id);
    formData.set("triviaStatus", "UNCERTAIN");
    formData.set("overrideDuplicates", "true");

    await expectRedirect(updateCompany(company.id, undefined, formData));

    const history = await testPrisma.pipelineStageHistory.findMany({ where: { companyId: company.id } });
    expect(history).toHaveLength(1);
    expect(history[0].fromStageId).toBe(stageNew.id);
    expect(history[0].toStageId).toBe(stageDemo.id);
  });

  it("writes the same shape of row from the board's quick stage-change action", async () => {
    const { user, leadType, stageNew, stageDemo } = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: user.id, createdById: user.id });
    await loginAs(user.id);

    await changeCompanyStage(company.id, stageDemo.id);

    const history = await testPrisma.pipelineStageHistory.findMany({ where: { companyId: company.id } });
    expect(history).toHaveLength(1);
    expect(history[0].fromStageId).toBe(stageNew.id);
    expect(history[0].toStageId).toBe(stageDemo.id);
  });

  it("writes one row per company for a bulk stage change", async () => {
    const { user, leadType, stageNew, stageDemo } = await baseFixtures();
    const companies = await Promise.all(
      [1, 2, 3].map(() => createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: user.id, createdById: user.id })),
    );
    await loginAs(user.id);

    await bulkChangeStage(companies.map((c) => c.id), stageDemo.id);

    for (const company of companies) {
      const history = await testPrisma.pipelineStageHistory.findMany({ where: { companyId: company.id } });
      expect(history).toHaveLength(1);
      expect(history[0].toStageId).toBe(stageDemo.id);
    }
  });

  it("records the loss reason only when the target stage is a LOST outcome", async () => {
    const { user, leadType, stageNew, stageDemo, stageLost } = await baseFixtures();
    const reason = await createRejectionReasonFixture("Chain Decision");
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stageNew.id, assignedToId: user.id, createdById: user.id });
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("name", company.name);
    formData.set("city", company.city);
    formData.set("region", company.region);
    formData.set("country", company.country);
    formData.set("leadTypeId", leadType.id);
    formData.set("pipelineStageId", stageLost.id);
    formData.set("lossReasonId", reason.id);
    formData.set("assignedToId", user.id);
    formData.set("triviaStatus", "UNCERTAIN");
    formData.set("overrideDuplicates", "true");

    await expectRedirect(updateCompany(company.id, undefined, formData));

    const [lossEntry] = await testPrisma.pipelineStageHistory.findMany({ where: { companyId: company.id } });
    expect(lossEntry.lossReasonId).toBe(reason.id);

    // Move it again into a non-Lost stage with a stale lossReasonId still in
    // the form payload — it must never be recorded against a non-Lost move.
    const formData2 = new FormData();
    formData2.set("name", company.name);
    formData2.set("city", company.city);
    formData2.set("region", company.region);
    formData2.set("country", company.country);
    formData2.set("leadTypeId", leadType.id);
    formData2.set("pipelineStageId", stageDemo.id);
    formData2.set("lossReasonId", reason.id);
    formData2.set("assignedToId", user.id);
    formData2.set("triviaStatus", "UNCERTAIN");
    formData2.set("overrideDuplicates", "true");

    await expectRedirect(updateCompany(company.id, undefined, formData2));

    const secondEntry = await testPrisma.pipelineStageHistory.findFirst({ where: { companyId: company.id, toStageId: stageDemo.id } });
    expect(secondEntry?.lossReasonId).toBeNull();
  });
});
