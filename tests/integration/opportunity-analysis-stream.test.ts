import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { POST as analyzeOpportunityStream } from "../../src/app/api/companies/[id]/analyze-opportunity/route";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function readEvents(response: Response): Promise<{ type: string; message?: string; result?: unknown }[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

describe("POST /api/companies/[id]/analyze-opportunity (streaming)", () => {
  it("streams status events (real provider activity, not a synthetic timer) followed by a done event", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads", "run_research", "bulk_update_leads", "edit_leads"]);
    const admin = await createTestUser({ roleId: role.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: admin.id, createdById: admin.id });
    await loginAs(admin.id);

    const response = await analyzeOpportunityStream(new Request("http://localhost/x", { method: "POST" }), paramsFor(company.id));
    expect(response.status).toBe(200);

    const events = await readEvents(response);
    const statusEvents = events.filter((e) => e.type === "status");
    const doneEvent = events.find((e) => e.type === "done");

    // At least the route's own "Starting analysis..." plus the mock
    // provider's own two canned progress messages.
    expect(statusEvents.length).toBeGreaterThanOrEqual(3);
    expect(statusEvents.some((e) => e.message?.includes("Searching the web"))).toBe(true);
    expect(doneEvent).toBeTruthy();
    expect((doneEvent as { result: { companyId: string } }).result.companyId).toBe(company.id);

    // Confirms the streamed "done" result matches what actually landed in
    // the database — the stream isn't just narrating, it's reporting real
    // persisted state.
    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect((doneEvent as { result: { eosTotal: number } }).result.eosTotal).toBe(updated.eosScore);
  });

  it("streams an error event rather than throwing when the company is out of scope", async () => {
    const roleA = await createRoleWithPermissions("TeamA", ["view_assigned_leads", "run_research", "bulk_update_leads", "edit_leads"]);
    const userA = await createTestUser({ roleId: roleA.id });
    const roleB = await createRoleWithPermissions("TeamB", ["view_assigned_leads", "run_research", "bulk_update_leads", "edit_leads"]);
    const userB = await createTestUser({ roleId: roleB.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: userA.id, createdById: userA.id });

    await loginAs(userB.id);
    const response = await analyzeOpportunityStream(new Request("http://localhost/x", { method: "POST" }), paramsFor(company.id));
    expect(response.status).toBe(200);

    const events = await readEvents(response);
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });
});
