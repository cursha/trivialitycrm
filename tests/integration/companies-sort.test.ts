import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, fetchAuthenticatedUser } from "../helpers/fixtures";
import { listCompanies } from "../../src/app/(dashboard)/companies/queries";

beforeEach(async () => {
  await resetDatabase();
});

async function companiesWithScores(scores: Record<string, number | null>) {
  const role = await createRoleWithPermissions("Sorter", ["view_all_leads"]);
  const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture();
  for (const [name, eosScore] of Object.entries(scores)) {
    const company = await createCompanyFixture({ name, leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
    await testPrisma.company.update({ where: { id: company.id }, data: { eosScore } });
  }
  return user;
}

describe("Companies list sorting", () => {
  it("sorts by EOS score with unscored bars last in both directions, ties by name", async () => {
    const user = await companiesWithScores({ "Unscored A": null, "Low Pub": 40, "Top Pub": 90, "Mid B": 70, "Mid A": 70, "Unscored B": null });

    const desc = await listCompanies(user, { sortBy: "eosScore", sortDir: "desc" });
    expect(desc.companies.map((c) => c.name)).toEqual(["Top Pub", "Mid A", "Mid B", "Low Pub", "Unscored A", "Unscored B"]);

    const asc = await listCompanies(user, { sortBy: "eosScore", sortDir: "asc" });
    expect(asc.companies.map((c) => c.name)).toEqual(["Low Pub", "Mid A", "Mid B", "Top Pub", "Unscored A", "Unscored B"]);
  });
});
