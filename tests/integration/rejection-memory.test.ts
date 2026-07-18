import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createLeadSearchFixture,
  createSearchResultFixture,
} from "../helpers/fixtures";
import { findPriorRejectedMatches } from "../../src/lib/duplicates/match";
import { testPrisma } from "../helpers/db";

beforeEach(async () => {
  await resetDatabase();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture("Pub");
  const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });
  return { user, leadType, search };
}

describe("findPriorRejectedMatches", () => {
  it("matches a new candidate against a previously rejected result by normalized name", async () => {
    const { search } = await baseFixtures();
    await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle", disposition: "REJECTED" });

    const matches = await findPriorRejectedMatches(testPrisma, { name: "the copper kettle", city: "Milton", region: "ON", country: "Canada" });

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedOn).toContain("name");
  });

  it("matches by website domain across two different searches", async () => {
    const { search, user, leadType } = await baseFixtures();
    const otherSearch = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id, region: "BC" });

    await createSearchResultFixture({
      searchId: search.id,
      name: "Original Name Ltd",
      websiteUrl: "https://example.test/pub",
      disposition: "REJECTED",
    });

    const matches = await findPriorRejectedMatches(testPrisma, {
      name: "Totally Different Name",
      city: "Vancouver",
      region: "BC",
      country: "Canada",
      websiteUrl: "https://www.example.test/pub",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedOn).toContain("websiteDomain");
    expect(otherSearch.id).not.toBe(search.id);
  });

  it("does not match a result that was not rejected", async () => {
    const { search } = await baseFixtures();
    await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle", disposition: "NEW" });

    const matches = await findPriorRejectedMatches(testPrisma, { name: "the copper kettle", city: "Milton", region: "ON", country: "Canada" });

    expect(matches).toHaveLength(0);
  });

  it("returns no matches for an unrelated candidate", async () => {
    const { search } = await baseFixtures();
    await createSearchResultFixture({ searchId: search.id, name: "The Copper Kettle", disposition: "REJECTED" });

    const matches = await findPriorRejectedMatches(testPrisma, { name: "Totally Unrelated Bar", city: "Ottawa", region: "ON", country: "Canada" });

    expect(matches).toHaveLength(0);
  });
});
