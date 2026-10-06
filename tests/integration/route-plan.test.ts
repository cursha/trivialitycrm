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
  createRoute,
  updateRoute,
  selectRoute,
  deleteRoute,
  listRoutes,
  getCompanyRouteOptions,
  getAllRoutedCompanyIds,
} from "../../src/lib/route-plan/service";

beforeEach(async () => {
  await resetDatabase();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("Salesperson", ["view_all_leads", "view_route_plan", "manage_route_plan", "bulk_update_leads", "export_route_plan"]);
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
    expect(second).toEqual({ ok: true, count: 1, alreadyInRoute: true, routeName: "My route" });

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
    expect(await getRouteSummary(f.user.id)).toMatchObject({ name: "My route", count: 0, leadTypeId: null, leadTypeName: null, country: null });

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
    expect(result).toEqual({ ok: true, addedCount: 2, alreadyInRouteCount: 0, routeName: "My route" });
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
    expect(result).toEqual({ ok: true, addedCount: 1, alreadyInRouteCount: 1, routeName: "My route" });
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

  it("bulk-adds to a chosen route, or to a new route made on the spot, without changing the current route", async () => {
    const f = await baseFixtures();
    const a = await makeCompany(f);
    const b = await makeCompany(f);
    await createRoute(f.user, "Mississauga", null);
    await createRoute(f.user, "Burlington", null); // now current
    const mississauga = (await listRoutes(f.user.id)).find((r) => r.name === "Mississauga")!;

    expect(await bulkAddCompaniesToRoute(f.user, [a.id, b.id], { routeId: mississauga.id })).toEqual({ ok: true, addedCount: 2, alreadyInRouteCount: 0, routeName: "Mississauga" });
    expect(await bulkAddCompaniesToRoute(f.user, [a.id], { newRoute: { name: "Oakville", plannedDate: "2026-10-09" } })).toEqual({ ok: true, addedCount: 1, alreadyInRouteCount: 0, routeName: "Oakville" });

    expect((await listRoutes(f.user.id)).map((r) => [r.name, r.count, r.isActive])).toEqual([
      ["Oakville", 1, false],
      ["Burlington", 0, true],
      ["Mississauga", 2, false],
    ]);
  });

  it("leaves no new route behind when a batch for a new route is rejected", async () => {
    const f = await baseFixtures();
    const pub = await makeCompany(f, { leadTypeId: f.pubType.id });
    const seniorHome = await makeCompany(f, { leadTypeId: f.seniorHomeType.id });

    const result = await bulkAddCompaniesToRoute(f.user, [pub.id, seniorHome.id], { newRoute: { name: "Oakville", plannedDate: null } });
    expect(result).toMatchObject({ ok: false, conflict: { type: "lead_type_conflict" } });
    expect(await listRoutes(f.user.id)).toEqual([]);
    expect(await bulkAddCompaniesToRoute(f.user, [pub.id], { newRoute: { name: "  ", plannedDate: null } })).toEqual({ ok: false, error: "Give the route a name, e.g. Mississauga." });
  });

  it("refuses to bulk-add to another user's route", async () => {
    const f = await baseFixtures();
    const role = await createRoleWithPermissions("Joe2", ["view_all_leads", "view_route_plan", "manage_route_plan"]);
    const joe = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const bar = await makeCompany(f);
    await createRoute(joe, "Joe's Oakville", null);
    const joesRoute = (await listRoutes(joe.id))[0];

    expect(await bulkAddCompaniesToRoute(f.user, [bar.id], { routeId: joesRoute.id })).toEqual({ ok: false, error: "That route no longer exists." });
    expect((await listRoutes(joe.id))[0].count).toBe(0);
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
    expect(result).toEqual({ ok: false, error: "This route is empty — add companies before exporting." });
  });

  it("refuses to export while a company no longer matches the route's lead type/country", async () => {
    const f = await baseFixtures();
    const company = await makeCompany(f);
    await addCompanyToRoute(f.user, company.id);
    await testPrisma.company.update({ where: { id: company.id }, data: { country: "USA" } });

    const result = await exportRoutePlanCsv(f.user);
    expect(result).toEqual({ ok: false, error: "1 company in this route no longer match its lead type or country — remove it before exporting." });
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

describe("multiple routes per user", () => {
  it("adds a bar to a chosen route, or to a new route made on the spot, without changing the current route", async () => {
    const f = await baseFixtures();
    const bar = await makeCompany(f, { name: "Bar A" });
    const other = await makeCompany(f, { name: "Bar B" });

    expect(await createRoute(f.user, "Mississauga", "2026-10-06")).toEqual({ ok: true });
    expect(await createRoute(f.user, "Burlington", null)).toEqual({ ok: true }); // now current
    const mississauga = (await listRoutes(f.user.id)).find((r) => r.name === "Mississauga")!;

    expect(await addCompanyToRoute(f.user, bar.id, { routeId: mississauga.id })).toMatchObject({ ok: true, routeName: "Mississauga", count: 1 });
    expect(await addCompanyToRoute(f.user, bar.id, { newRoute: { name: "Oakville", plannedDate: "2026-10-09" } })).toMatchObject({ ok: true, routeName: "Oakville" });
    expect(await addCompanyToRoute(f.user, other.id)).toMatchObject({ ok: true, routeName: "Burlington" }); // no target = current

    const options = await getCompanyRouteOptions(f.user.id, bar.id);
    expect(options.filter((o) => o.inRoute).map((o) => o.name).sort()).toEqual(["Mississauga", "Oakville"]);
    expect(options.find((o) => o.isActive)?.name).toBe("Burlington");
    expect([...(await getAllRoutedCompanyIds(f.user.id))].sort()).toEqual([bar.id, other.id].sort());

    // Dated routes first, soonest first, then undated by name.
    expect((await listRoutes(f.user.id)).map((r) => [r.name, r.plannedDate, r.count])).toEqual([
      ["Mississauga", "2026-10-06", 1],
      ["Oakville", "2026-10-09", 1],
      ["Burlington", null, 1],
    ]);

    // Removing from one route leaves the others alone.
    await removeCompanyFromRoute(f.user, bar.id, mississauga.id);
    expect((await getCompanyRouteOptions(f.user.id, bar.id)).filter((o) => o.inRoute).map((o) => o.name)).toEqual(["Oakville"]);
  });

  it("switches, renames, re-dates and deletes routes; the export is named and dated by the route", async () => {
    const f = await baseFixtures();
    const bar = await makeCompany(f);
    await createRoute(f.user, "Hamilton", "2026-10-09");
    await addCompanyToRoute(f.user, bar.id);
    const hamilton = (await listRoutes(f.user.id))[0];

    expect((await getRouteDetail(f.user)).exportFilename).toBe("pub-hamilton-route-2026-10-09.csv");

    expect(await updateRoute(f.user, hamilton.id, "Hamilton East", "2026-10-10")).toEqual({ ok: true });
    expect(await updateRoute(f.user, hamilton.id, "  ", null)).toEqual({ ok: false, error: "Give the route a name, e.g. Mississauga." });
    expect(await updateRoute(f.user, hamilton.id, "X", "2026-02-30")).toEqual({ ok: false, error: "Enter a valid date." });
    expect((await getRouteSummary(f.user.id))).toMatchObject({ name: "Hamilton East", plannedDate: "2026-10-10", count: 1 });

    await createRoute(f.user, "Milton", null);
    expect((await getRouteSummary(f.user.id)).name).toBe("Milton");
    expect(await selectRoute(f.user, hamilton.id)).toEqual({ ok: true });
    expect((await getRouteSummary(f.user.id)).name).toBe("Hamilton East");

    // Deleting the current route makes the next one current; the bar itself stays.
    expect(await deleteRoute(f.user, hamilton.id)).toEqual({ ok: true });
    expect((await getRouteSummary(f.user.id)).name).toBe("Milton");
    expect(await testPrisma.company.findUnique({ where: { id: bar.id } })).not.toBeNull();
  });

  it("leaves no new route behind when adding a bar to it is rejected", async () => {
    const f = await baseFixtures();
    const ineligible = await makeCompany(f, { leadTypeId: f.ineligibleType.id });

    expect(await addCompanyToRoute(f.user, ineligible.id, { newRoute: { name: "Oakville", plannedDate: null } })).toMatchObject({ ok: false, conflict: { type: "ineligible" } });
    expect(await listRoutes(f.user.id)).toEqual([]);
  });

  it("never lets one user touch another user's route", async () => {
    const f = await baseFixtures();
    const role = await createRoleWithPermissions("Joe", ["view_all_leads", "view_route_plan", "manage_route_plan"]);
    const joe = await fetchAuthenticatedUser((await createTestUser({ roleId: role.id })).id);
    const bar = await makeCompany(f);
    await createRoute(joe, "Joe's Oakville", null);
    const joesRoute = (await listRoutes(joe.id))[0];

    expect(await addCompanyToRoute(f.user, bar.id, { routeId: joesRoute.id })).toEqual({ ok: false, error: "That route no longer exists." });
    expect(await selectRoute(f.user, joesRoute.id)).toEqual({ ok: false, error: "That route no longer exists." });
    expect(await updateRoute(f.user, joesRoute.id, "Mine now", null)).toEqual({ ok: false, error: "That route no longer exists." });
    expect(await deleteRoute(f.user, joesRoute.id)).toEqual({ ok: false, error: "That route no longer exists." });
    expect(await listRoutes(f.user.id)).toEqual([]);
    expect((await listRoutes(joe.id)).map((r) => r.name)).toEqual(["Joe's Oakville"]);
  });
});
