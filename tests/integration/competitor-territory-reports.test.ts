import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompanyFixture,
  createCompetitorFixture,
  fetchAuthenticatedUser,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { getCompetitorsReport } from "../../src/app/(dashboard)/reports/competitors/queries";
import { getTerritoriesReport } from "../../src/app/(dashboard)/reports/territories/queries";
import type { ReportFilters } from "../../src/lib/reports/filters";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

const defaultFilters: ReportFilters = { dateRange: "month" };

describe("getCompetitorsReport", () => {
  it("is gated on view_competitor_reports even when the user has base report access", async () => {
    const role = await createRoleWithPermissions("ReporterOnly", ["view_all_reports"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);

    const result = await getCompetitorsReport(user, defaultFilters);
    expect(result).toEqual({ forbidden: true });
  });

  it("computes linked-lead counts live from Company.competitorId — never a stored tally", async () => {
    const role = await createRoleWithPermissions("Reporter", ["view_all_reports", "view_competitor_reports"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const competitor = await createCompetitorFixture("Trivia Rivals");
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, competitorId: competitor.id });
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, competitorId: competitor.id });
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, competitorId: null });

    const result = await getCompetitorsReport(user, defaultFilters);
    if (!result || result.forbidden) throw new Error("expected access");
    const row = result.rows.find((r) => r.competitorId === competitor.id);
    expect(row?.linkedLeads).toBe(2);
  });
});

describe("getTerritoriesReport", () => {
  it("labels a territory with zero matched leads as having none recorded, not as having no prospects", async () => {
    const role = await createRoleWithPermissions("Reporter", ["view_all_reports"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    await testPrisma.territory.create({ data: { name: "Empty Territory", country: "Canada", region: "AB", city: null } });

    const result = await getTerritoriesReport(user, defaultFilters);
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].leadCount).toBe(0);
  });

  it("matches a company to the most specific overlapping territory (city over region over country)", async () => {
    const role = await createRoleWithPermissions("Reporter", ["view_all_reports"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });

    const countryTerritory = await testPrisma.territory.create({ data: { name: "All Canada", country: "Canada", region: null, city: null } });
    const cityTerritory = await testPrisma.territory.create({ data: { name: "Milton Only", country: "Canada", region: "ON", city: "Milton" } });
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, city: "Milton", region: "ON", country: "Canada" });

    const result = await getTerritoriesReport(user, defaultFilters);
    const cityRow = result?.rows.find((r) => r.territoryId === cityTerritory.id);
    const countryRow = result?.rows.find((r) => r.territoryId === countryTerritory.id);
    expect(cityRow?.leadCount).toBe(1);
    expect(countryRow?.leadCount).toBe(0);
  });

  it("counts active leads whose location matches no configured territory separately, as 'not yet researched'", async () => {
    const role = await createRoleWithPermissions("Reporter", ["view_all_reports"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id, city: "Nowhere", region: "XX", country: "Nowhereland" });

    const result = await getTerritoriesReport(user, defaultFilters);
    expect(result?.unmatched).toBe(1);
  });
});
