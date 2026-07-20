import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createTeam,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompanyFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { GET as exportReport } from "../../src/app/api/reports/[reportKey]/export/route";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function params(reportKey: string) {
  return { params: Promise.resolve({ reportKey }) };
}

describe("GET /api/reports/[reportKey]/export", () => {
  it("blocks a user without export_reports", async () => {
    const role = await createRoleWithPermissions("NoExport", ["view_all_reports"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(
      exportReport(new Request("http://localhost/api/reports/pipeline/export?format=csv"), params("pipeline")),
    ).rejects.toThrow(/Forbidden/);
  });

  it("404s on an unrecognized report key", async () => {
    const role = await createRoleWithPermissions("Exporter", ["view_all_reports", "export_reports"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const response = await exportReport(new Request("http://localhost/api/reports/bogus/export?format=csv"), params("bogus"));
    expect(response.status).toBe(404);
  });

  it("includes the report name, date range, filters, and generation timestamp in the CSV", async () => {
    const role = await createRoleWithPermissions("Exporter", ["view_all_reports", "export_reports"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const response = await exportReport(
      new Request("http://localhost/api/reports/pipeline/export?format=csv&dateRange=month"),
      params("pipeline"),
    );
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(body).toContain("Report: Pipeline Report");
    expect(body).toContain("Date range: This month");
    expect(body).toContain("Filters:");
    expect(body).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  });

  it("neutralizes a formula-injection attempt in exported lead-type data", async () => {
    const role = await createRoleWithPermissions("Exporter", ["view_all_reports", "export_reports"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const dangerousLeadType = await createLeadTypeFixture("=cmd|'/C calc'!A1");
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({ leadTypeId: dangerousLeadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });

    const response = await exportReport(new Request("http://localhost/api/reports/lead-types/export?format=csv"), params("lead-types"));
    const body = await response.text();

    expect(body).not.toContain("\n=cmd");
    expect(body).toContain("'=cmd|'/C calc'!A1");
  });

  it("never exports data outside the requesting user's report scope", async () => {
    const teamA = await createTeam("Team A");
    const teamB = await createTeam("Team B");
    const roleA = await createRoleWithPermissions("SalesA", ["view_own_reports", "export_reports"]);
    const roleB = await createRoleWithPermissions("SalesB", ["view_own_reports"]);
    const userA = await createTestUser({ name: "User A", roleId: roleA.id, teamId: teamA.id });
    const userB = await createTestUser({ name: "User B", roleId: roleB.id, teamId: teamB.id });
    const leadType = await createLeadTypeFixture("Pub");
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    await createCompanyFixture({ name: "User A's Company", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: userA.id, createdById: userA.id, source: "MANUAL" });
    await createCompanyFixture({ name: "User B's Company", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: userB.id, createdById: userB.id, source: "MANUAL" });

    await loginAs(userA.id);
    const response = await exportReport(new Request("http://localhost/api/reports/sources/export?format=csv"), params("sources"));
    const body = await response.text();

    // "own" scope for User A should see exactly 1 Manual lead (their own),
    // not 2 (which would mean User B's company leaked into the export).
    expect(body).toContain("Manual,1");
  });
});
