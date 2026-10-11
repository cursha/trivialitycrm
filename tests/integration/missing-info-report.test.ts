import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { getCurrentUser } from "../../src/lib/auth/current-user";
import { reportScope } from "../../src/lib/reports/scope";
import { listMissingInfo } from "../../src/lib/data-quality/missing-info";
import { MISSING_FIELDS, parseMissingFields } from "../../src/lib/data-quality/missing-info-fields";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function setup(permissions: string[]) {
  const role = await createRoleWithPermissions("Reporter", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  await loginAs(user.id);

  async function company(name: string, data: { phone?: string | null; websiteUrl?: string | null; email?: string | null; eosScore?: number | null }, assignedToId: string | null = null) {
    const created = await createCompanyFixture({ name, leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId, createdById: user.id });
    await testPrisma.company.update({ where: { id: created.id }, data: { phone: "555-0100", websiteUrl: "https://bar.test", email: "hi@bar.test", eosScore: 70, ...data } });
    return created;
  }
  return { user, company };
}

async function names(fields = [...MISSING_FIELDS], extra: Record<string, string> = {}) {
  const user = await getCurrentUser();
  const result = await listMissingInfo(user!, reportScope(user!)!, { fields, ...extra });
  return { names: result!.companies.map((c) => c.name).sort(), result: result! };
}

describe("listMissingInfo", () => {
  it("lists locations missing any ticked field, counting blank text as missing", async () => {
    const { company } = await setup(["view_all_leads", "view_all_reports"]);
    await company("Complete", {});
    await company("No Phone", { phone: null });
    await company("Blank Website", { websiteUrl: "" });
    await company("No Email", { email: null });
    await company("No EOS", { eosScore: null });

    const all = await names();
    expect(all.names).toEqual(["Blank Website", "No EOS", "No Email", "No Phone"]);
    expect(all.result.counts).toEqual({ phone: 1, websiteUrl: 1, email: 1, eosScore: 1 });

    expect((await names(["phone", "eosScore"])).names).toEqual(["No EOS", "No Phone"]);
    // Counts beside every checkbox stay visible whatever is ticked.
    expect((await names(["phone"])).result.counts.email).toBe(1);
  });

  it("only shows a rep their own locations under an own-reports scope", async () => {
    const { user, company } = await setup(["view_all_leads", "view_own_reports"]);
    await company("Mine", { phone: null }, user.id);
    await company("Someone Else's", { phone: null }, null);

    expect((await names()).names).toEqual(["Mine"]);
  });

  it("applies the usual company filters", async () => {
    const { company } = await setup(["view_all_leads", "view_all_reports"]);
    const milton = await company("Milton Pub", { phone: null });
    await company("Toronto Pub", { phone: null });
    await testPrisma.company.update({ where: { id: milton.id }, data: { city: "Milton" } });

    expect((await names([...MISSING_FIELDS], { city: "Milton" })).names).toEqual(["Milton Pub"]);
  });
});

describe("parseMissingFields", () => {
  it("reads the ticked fields, defaulting to all four", () => {
    expect(parseMissingFields("email,phone")).toEqual(["phone", "email"]);
    expect(parseMissingFields(undefined)).toEqual([...MISSING_FIELDS]);
    expect(parseMissingFields("nonsense")).toEqual([...MISSING_FIELDS]);
  });
});
