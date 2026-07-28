import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, fetchAuthenticatedUser } from "../helpers/fixtures";
import {
  getRouteSummary,
  getRouteCompanyIds,
  addCompanyToRoute,
  removeCompanyFromRoute,
  clearRoute,
  bulkAddCompaniesToRoute,
  getRouteDetail,
  exportRoutePlanCsv,
} from "../../src/lib/route-plan/service";

beforeEach(async () => {
  await resetDatabase();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Salesperson", ["view_all_leads", "manage_route_plan", "bulk_update_leads", "export_route_plan"]);
  const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
  const stage = await createPipelineStageFixture();
  const pubType = await createLeadTypeFixture("Pub Trivia", { routePlanEnabled: true, routePlanSlug: "pub" });
  const seniorHomeType = await createLeadTypeFixture("Senior Home", { routePlanEnabled: true });
  const ineligibleType = await createLeadTypeFixture("Not Route-Eligible", { routePlanEnabled: false });
  return { user, stage, pubType, seniorHomeType, ineligibleType };
}

async function makeCompany(f: Awaited<ReturnType<typeof baseFixtures>>, overrides: { leadTypeId?: string; country?: string; name?: string } = {}) {
  return createCompanyFixture({
    leadTypeId: overrides.leadTypeId ?? f.pubType.id,
    pipelineStageId: f.stage.id,
    assignedToId: f.user.id,
    createdById: f.user.id,
    country: overrides.country ?? "Canada",
    name: overrides.name,
  });
}

describe("addCompanyToRoute", () => {
  it("the first company establishes the route's lead type and country", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f);

    const result = await addCompanyToRoute(f.user, company.id);
    expect(result).toMatchObject({ ok: true, count: 1, alreadyInRoute: false });

    const summary = await getRouteSummary(f.user.id);
    expect(summary).toMatchObject({ count: 1, leadTypeId: f.pubType.id, country: "Canada" });
  });

  it("rejects an ineligible lead type", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f, { leadTypeId: f.ineligibleType.id });

    const result = await addCompanyToRoute(f.user, company.id);
    expect(result).toEqual({ ok: false, conflict: { type: "ineligible", leadTypeName: "Not Route-Eligible" } });
    expect((await getRouteSummary(f.user.id)).count).toBe(0);
  });

  it("rejects a different lead type as a conflict, pending resolution", async () => {
    const f = await baseFixtures();
    const pub = await makeCompany(f, { leadTypeId: f.pubType.id });
    const seniorHome = await makeCompany(f, { leadTypeId: f.seniorHomeType.id });

    await addCompanyToRoute(f.user, pub.id);
    const result = await addCompanyToRoute(f.user, seniorHome.id);
    expect(result).toEqual({ ok: false, conflict: { type: "lead_type_conflict", currentLeadTypeName: "Pub Trivia", newLeadTypeName: "Senior Home" } });
    // The conflicting company must NOT have been added.
    expect((await getRouteSummary(f.user.id)).count).toBe(1);
  });

  it("rejects a different country as a conflict, pending resolution", async () => {
    const f = await baseFixtures();
    const canadian = await makeCompany(f, { country: "Canada" });
    const american = await makeCompany(f, { country: "USA" });

    await addCompanyToRoute(f.user, canadian.id);
    const result = await addCompanyToRoute(f.user, american.id);
    expect(result).toEqual({ ok: false, conflict: { type: "country_conflict", currentCountry: "Canada", newCountry: "USA" } });
    expect((await getRouteSummary(f.user.id)).count).toBe(1);
  });

  it("matches country case/whitespace-insensitively — 'canada' does not conflict with 'Canada'", async () => {
    const f = await baseFixtures();
    const first = await makeCompany(f, { country: "Canada" });
    const second = await makeCompany(f, { country: " canada " });

    await addCompanyToRoute(f.user, first.id);
    const result = await addCompanyToRoute(f.user, second.id);
    expect(result).toMatchObject({ ok: true });
    expect((await getRouteSummary(f.user.id)).count).toBe(2);
  });

  it("is idempotent — adding the same company twice does not duplicate it", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f);

    await addCompanyToRoute(f.user, company.id);
    const second = await addCompanyToRoute(f.user, company.id);
    expect(second).toEqual({ ok: true, count: 1, alreadyInRoute: true });

    const rows = await testPrisma.routePlanCompany.findMany({ where: { company: { id: company.id } } });
    expect(rows).toHaveLength(1);
  });

  it("requires manage_route_plan", async () => {
    const role = await createRoleWithPermissions("NoAccess", ["view_all_leads"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const f = await baseFixtures();
    const company = await makeCompany(f);

    await expect(addCompanyToRoute(user, company.id)).rejects.toThrow();
  });

  it("denies access to a company outside the user's scope", async () => {
    const roleA = await createRoleWithPermissions("TeamA", ["view_assigned_leads", "manage_route_plan"]);
    const userA = await fetchAuthenticatedUser((await createTestUser({ roleId: roleA.id })).id);
    const roleB = await createRoleWithPermissions("TeamB", ["view_assigned_leads", "manage_route_plan"]);
    const userB = await fetchAuthenticatedUser((await createTestUser({ roleId: roleB.id })).id);
    const f = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: f.pubType.id, pipelineStageId: f.stage.id, assignedToId: userA.id, createdById: userA.id });

    const result = await addCompanyToRoute(userB, company.id);
    expect(result).toEqual({ ok: false, error: "Company not found or access denied." });
  });
});

describe("private per-user route", () => {
  it("one user's route is invisible to and unaffected by another user's actions", async () => {
    const f = await baseFixtures();
    const roleB = await createRoleWithPermissions("Salesperson2", ["view_all_leads", "manage_route_plan", "bulk_update_leads"]);
    const userB = await fetchAuthenticatedUser((await createTestUser({ roleId: roleB.id })).id);
    const company = await makeCompany(f);

    await addCompanyToRoute(f.user, company.id);

    expect((await getRouteSummary(userB.id)).count).toBe(0);
    expect((await getRouteCompanyIds(userB.id)).has(company.id)).toBe(false);
    expect((await getRouteCompanyIds(f.user.id)).has(company.id)).toBe(true);

    // userB can independently build their own route with the same company —
    // routes are per-user, not exclusive/shared.
    const resultB = await addCompanyToRoute(userB, company.id);
    expect(resultB).toMatchObject({ ok: true, count: 1 });
    expect((await getRouteSummary(f.user.id)).count).toBe(1); // userA's route untouched
  });
});

describe("removeCompanyFromRoute", () => {
  it("removes only the specified company", async () => {
    const f = await baseFixtures();
    const a = await makeCompany(f);
    const b = await makeCompany(f);
    await addCompanyToRoute(f.user, a.id);
    await addCompanyToRoute(f.user, b.id);

    const result = await removeCompanyFromRoute(f.user, a.id);
    expect(result).toEqual({ count: 1 });
    expect((await getRouteCompanyIds(f.user.id)).has(a.id)).toBe(false);
    expect((await getRouteCompanyIds(f.user.id)).has(b.id)).toBe(true);
  });

  it("removing a company not in the route is a silent no-op", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f);
    const result = await removeCompanyFromRoute(f.user, company.id);
    expect(result).toEqual({ count: 0 });
  });
});

describe("clearRoute", () => {
  it("removes every company and resets the established lead type/country", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f);
    await addCompanyToRoute(f.user, company.id);

    await clearRoute(f.user);
    expect(await getRouteSummary(f.user.id)).toEqual({ count: 0, leadTypeId: null, leadTypeName: null, country: null });

    // A different lead type/country can now start a fresh route.
    const seniorHome = await makeCompany(f, { leadTypeId: f.seniorHomeType.id, country: "USA" });
    const result = await addCompanyToRoute(f.user, seniorHome.id);
    expect(result).toMatchObject({ ok: true, count: 1 });
  });
});

describe("bulkAddCompaniesToRoute", () => {
  it("adds every valid company in one transaction", async () => {
    const f = await baseFixtures();
    const a = await makeCompany(f);
    const b = await makeCompany(f);

    const result = await bulkAddCompaniesToRoute(f.user, [a.id, b.id]);
    expect(result).toEqual({ ok: true, addedCount: 2, alreadyInRouteCount: 0 });
    expect((await getRouteSummary(f.user.id)).count).toBe(2);
  });

  it("does not partially change the route when the batch has a lead-type conflict", async () => {
    const f = await baseFixtures();
    const pub = await makeCompany(f, { leadTypeId: f.pubType.id });
    const seniorHome = await makeCompany(f, { leadTypeId: f.seniorHomeType.id });

    const result = await bulkAddCompaniesToRoute(f.user, [pub.id, seniorHome.id]);
    expect(result).toEqual({ ok: false, conflict: { type: "lead_type_conflict", currentLeadTypeName: "Pub Trivia", newLeadTypeName: "Senior Home" } });
    // Nothing committed — not even the pub, which was valid on its own.
    expect((await getRouteSummary(f.user.id)).count).toBe(0);
  });

  it("does not partially change the route when the batch has a country conflict", async () => {
    const f = await baseFixtures();
    const canadian = await makeCompany(f, { country: "Canada" });
    const american = await makeCompany(f, { country: "USA" });

    const result = await bulkAddCompaniesToRoute(f.user, [canadian.id, american.id]);
    expect(result).toEqual({ ok: false, conflict: { type: "country_conflict", currentCountry: "Canada", newCountry: "USA" } });
    expect((await getRouteSummary(f.user.id)).count).toBe(0);
  });

  it("rejects a batch containing an ineligible lead type", async () => {
    const f = await baseFixtures();
    const ineligible = await makeCompany(f, { leadTypeId: f.ineligibleType.id });

    const result = await bulkAddCompaniesToRoute(f.user, [ineligible.id]);
    expect(result).toEqual({ ok: false, conflict: { type: "ineligible", leadTypeName: "Not Route-Eligible" } });
  });

  it("treats an already-in-route company as a no-op within the batch, not a conflict", async () => {
    const f = await baseFixtures();
    const a = await makeCompany(f);
    const b = await makeCompany(f);
    await addCompanyToRoute(f.user, a.id);

    const result = await bulkAddCompaniesToRoute(f.user, [a.id, b.id]);
    expect(result).toEqual({ ok: true, addedCount: 1, alreadyInRouteCount: 1 });
  });

  it("reports per-company errors for ids outside the user's scope without blocking valid ones", async () => {
    const roleA = await createRoleWithPermissions("TeamA2", ["view_assigned_leads", "manage_route_plan", "bulk_update_leads"]);
    const userA = await fetchAuthenticatedUser((await createTestUser({ roleId: roleA.id })).id);
    const f = await baseFixtures();
    const outOfScope = await createCompanyFixture({ leadTypeId: f.pubType.id, pipelineStageId: f.stage.id, assignedToId: f.user.id, createdById: f.user.id });
    const inScope = await createCompanyFixture({ leadTypeId: f.pubType.id, pipelineStageId: f.stage.id, assignedToId: userA.id, createdById: userA.id });

    const result = await bulkAddCompaniesToRoute(userA, [outOfScope.id, inScope.id]);
    expect(result).toMatchObject({ ok: false, perCompanyErrors: { [outOfScope.id]: "Company not found or access denied." } });
    // The valid one was still added — a scope failure on one id doesn't
    // block the rest of a legitimately mixed-validity batch.
    expect((await getRouteSummary(userA.id)).count).toBe(1);
  });

  it("requires bulk_update_leads in addition to manage_route_plan", async () => {
    const role = await createRoleWithPermissions("NoBulk", ["view_all_leads", "manage_route_plan"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const f = await baseFixtures();
    const company = await makeCompany(f);

    await expect(bulkAddCompaniesToRoute(user, [company.id])).rejects.toThrow();
  });
});

describe("getRouteDetail", () => {
  it("returns companies sorted alphabetically", async () => {
    const f = await baseFixtures();
    const zed = await makeCompany(f, { name: "Zed Pub" });
    const alpha = await makeCompany(f, { name: "Alpha Pub" });
    await addCompanyToRoute(f.user, zed.id);
    await addCompanyToRoute(f.user, alpha.id);

    const detail = await getRouteDetail(f.user);
    expect(detail.companies.map((c) => c.name)).toEqual(["Alpha Pub", "Zed Pub"]);
  });

  it("flags a company as no longer valid if its lead type changed after being added", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f, { leadTypeId: f.pubType.id });
    await addCompanyToRoute(f.user, company.id);

    await testPrisma.company.update({ where: { id: company.id }, data: { leadTypeId: f.seniorHomeType.id } });

    const detail = await getRouteDetail(f.user);
    expect(detail.companies[0].stillValid).toBe(false);
  });

  it("flags a company as no longer valid if its country changed after being added", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f, { country: "Canada" });
    await addCompanyToRoute(f.user, company.id);

    await testPrisma.company.update({ where: { id: company.id }, data: { country: "USA" } });

    const detail = await getRouteDetail(f.user);
    expect(detail.companies[0].stillValid).toBe(false);
  });

  it("excludes a company that fell outside the user's scope since being added", async () => {
    const roleManager = await createRoleWithPermissions("Manager2", ["view_team_leads", "manage_route_plan"]);
    const team = await testPrisma.team.create({ data: { name: "Team X" } });
    const manager = await fetchAuthenticatedUser((await createTestUser({ roleId: roleManager.id, teamId: team.id })).id);
    const f = await baseFixtures();
    const company = await createCompanyFixture({ leadTypeId: f.pubType.id, pipelineStageId: f.stage.id, assignedToId: manager.id, createdById: manager.id });
    await addCompanyToRoute(manager, company.id);

    // Reassign the company off the manager's team entirely.
    const otherRole = await createRoleWithPermissions("Other", ["view_assigned_leads"]);
    const otherUser = await createTestUser({ roleId: otherRole.id });
    await testPrisma.company.update({ where: { id: company.id }, data: { assignedToId: otherUser.id } });

    const detail = await getRouteDetail(manager);
    expect(detail.companies).toHaveLength(0);
  });
});

describe("exportRoutePlanCsv", () => {
  it("produces exactly the Name,Address header with correctly quoted rows, alphabetical, no country column", async () => {
    const f = await baseFixtures();
    const zed = await makeCompany(f, { name: "Zed Pub" });
    await testPrisma.company.update({ where: { id: zed.id }, data: { address1: "1 Main St", postalCode: "A1A 1A1" } });
    const alpha = await makeCompany(f, { name: "Alpha, Inc." });
    await testPrisma.company.update({ where: { id: alpha.id }, data: { address1: '2 "Elm" St', postalCode: "B2B 2B2" } });
    await addCompanyToRoute(f.user, zed.id);
    await addCompanyToRoute(f.user, alpha.id);

    const result = await exportRoutePlanCsv(f.user);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.csv.trim().split("\n");
    expect(lines[0]).toBe("Name,Address");
    // Alpha sorts first; its comma and embedded quote are both escaped
    // correctly by the shared buildCsv() serializer.
    expect(lines[1]).toBe('"Alpha, Inc.","2 ""Elm"" St, Testville, ON, B2B 2B2"');
    // The address itself contains commas (joined via ", "), so buildCsv
    // correctly quotes the whole field even though the company name didn't
    // need it.
    expect(lines[2]).toBe('Zed Pub,"1 Main St, Testville, ON, A1A 1A1"');
    expect(result.csv).not.toContain("Canada");
    expect(result.filename).toMatch(/^pub-route-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("builds the filename as <slug>-route-YYYY-MM-DD.csv with no time component", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f);
    await addCompanyToRoute(f.user, company.id);

    const result = await exportRoutePlanCsv(f.user);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filename).toMatch(/^pub-route-\d{4}-\d{2}-\d{2}\.csv$/);
    }
  });

  it("neutralizes a formula-injection attempt in a company name", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f, { name: "=HYPERLINK(\"http://evil.test\")" });
    await addCompanyToRoute(f.user, company.id);

    const result = await exportRoutePlanCsv(f.user);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.csv).toContain("'=HYPERLINK");
      expect(result.csv).not.toMatch(/^=HYPERLINK/m);
    }
  });

  it("refuses to export an empty route", async () => {
    const f = await baseFixtures();
    const result = await exportRoutePlanCsv(f.user);
    expect(result).toEqual({ ok: false, error: "Your Route Plan is empty — add companies before exporting." });
  });

  it("refuses to export while a company no longer matches the route's lead type/country", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f);
    await addCompanyToRoute(f.user, company.id);
    await testPrisma.company.update({ where: { id: company.id }, data: { country: "USA" } });

    const result = await exportRoutePlanCsv(f.user);
    expect(result).toEqual({ ok: false, error: "1 company in your Route Plan no longer match its lead type or country — remove it before exporting." });
  });

  it("refuses to export when the lead type has no routePlanSlug configured", async () => {
    const f = await baseFixtures();
    await testPrisma.leadType.update({ where: { id: f.pubType.id }, data: { routePlanSlug: null } });
    const company = await makeCompany(f);
    await addCompanyToRoute(f.user, company.id);

    const result = await exportRoutePlanCsv(f.user);
    expect(result).toEqual({ ok: false, error: "This lead type has no Route Plan filename configured yet — ask an administrator to set one in Settings > Lead Types." });
  });

  it("allows exporting an incomplete address (missing street/postal) without blocking", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f); // no address1/postalCode set
    await addCompanyToRoute(f.user, company.id);

    const result = await exportRoutePlanCsv(f.user);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.csv).toContain("Testville, ON");
    }
  });

  it("requires export_route_plan", async () => {
    const role = await createRoleWithPermissions("NoExport", ["view_all_leads", "manage_route_plan"]);
    const user = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const f = await baseFixtures();
    const company = await makeCompany(f);
    await addCompanyToRoute(f.user, company.id);

    await expect(exportRoutePlanCsv(user)).rejects.toThrow();
  });
});
