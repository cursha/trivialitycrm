import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createLeadSearchFixture, createSearchResultFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { GET as exportSearchResults } from "../../src/app/api/export/search-results/route";
import { GET as exportCompanies } from "../../src/app/api/export/companies/route";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("GET /api/export/search-results", () => {
  it("returns a CSV attachment with only the default (meets-minimum-score) results", async () => {
    const role = await createRoleWithPermissions("Exporter", ["export_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });
    await createSearchResultFixture({ searchId: search.id, name: "Included Bar", disposition: "NEW" });
    await createSearchResultFixture({ searchId: search.id, name: "Excluded Bar", disposition: "REJECTED" });

    const response = await exportSearchResults(new Request(`http://localhost/api/export/search-results?searchId=${search.id}&format=csv`));
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(body).toContain("Included Bar");
    expect(body).not.toContain("Excluded Bar");
  });

  it("includes rejected results when view=all", async () => {
    const role = await createRoleWithPermissions("Exporter", ["export_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });
    await createSearchResultFixture({ searchId: search.id, name: "Excluded Bar", disposition: "REJECTED" });

    const response = await exportSearchResults(new Request(`http://localhost/api/export/search-results?searchId=${search.id}&view=all&format=csv`));
    const body = await response.text();
    expect(body).toContain("Excluded Bar");
  });

  it("blocks a user without export_leads", async () => {
    const role = await createRoleWithPermissions("NoExport", ["review_research_results"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(exportSearchResults(new Request("http://localhost/api/export/search-results?searchId=x"))).rejects.toThrow(/Forbidden/);
  });

  // Module Ten regression: export routes had no rate limit at all — an
  // expensive, authorization-sensitive operation with zero throttling.
  it("is rate-limited", async () => {
    const role = await createRoleWithPermissions("RateLimitedExporter", ["export_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const leadType = await createLeadTypeFixture("Pub");
    const search = await createLeadSearchFixture({ createdById: user.id, leadTypeId: leadType.id });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await exportSearchResults(new Request(`http://localhost/api/export/search-results?searchId=${search.id}&format=csv`));
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });
});

describe("GET /api/export/companies", () => {
  it("only exports companies within the user's scope", async () => {
    const salesRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads", "export_leads"]);
    const otherRole = await createRoleWithPermissions("OtherSales", ["view_assigned_leads"]);
    const salesperson = await createTestUser({ name: "Sales A", roleId: salesRole.id });
    const other = await createTestUser({ name: "Sales B", roleId: otherRole.id });
    await loginAs(salesperson.id);

    const leadType = await createLeadTypeFixture("Pub");
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({ name: "Mine", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: salesperson.id, createdById: salesperson.id });
    await createCompanyFixture({ name: "Not Mine", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: other.id, createdById: other.id });

    const response = await exportCompanies(new Request("http://localhost/api/export/companies?format=csv"));
    const body = await response.text();

    expect(body).toContain("Mine");
    expect(body).not.toContain("Not Mine");
  });
});
