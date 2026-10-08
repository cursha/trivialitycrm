import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { searchOriginPubCompanies } from "../../src/app/(dashboard)/leads/pub-radius/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("Pub Lead Finder origin picker", () => {
  // Regression: it only matched a lead type named "Mayhem Lead", which
  // production doesn't have, so no origin pub could ever be found.
  it("finds active companies on any lead type, but not archived ones", async () => {
    const role = await createRoleWithPermissions("Rep", ["view_all_leads", "run_pub_lead_finder"]);
    const user = await createTestUser({ roleId: role.id });
    const pubs = await createLeadTypeFixture("pubs");
    const stage = await createPipelineStageFixture("Target", { isDefault: true });
    const base = { leadTypeId: pubs.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id };
    await createCompanyFixture({ ...base, name: "Keenans Irish Pub" });
    await createCompanyFixture({ ...base, name: "Keenans Old Location", status: "ARCHIVED" });
    await loginAs(user.id);

    const found = await searchOriginPubCompanies("keenan");

    expect(found.map((company) => company.name)).toEqual(["Keenans Irish Pub"]);
  });
});
