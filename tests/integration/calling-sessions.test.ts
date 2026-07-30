import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createSalesList, addCompaniesToList } from "../../src/app/(dashboard)/sales-lists/actions";
import {
  startCallingSession,
  pauseCallingSession,
  resumeCallingSession,
  endCallingSession,
  recordCallOutcome,
  skipEntryPermanently,
  updateCallRecordNotes,
} from "../../src/app/(dashboard)/calling-sessions/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions("CallingUser", ["view_sales_lists", "create_sales_lists", "manage_own_sales_lists", "use_calling_lists", "view_all_leads", "edit_leads"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  return { user, leadType, stage };
}

async function callingListWithCompanies(user: Awaited<ReturnType<typeof createTestUser>>, leadType: { id: string }, stage: { id: string }, count = 2) {
  const created = await createSalesList({ name: "Calling List", purpose: "CALLING", type: "FIXED", visibility: "PRIVATE" });
  if (!("success" in created)) throw new Error("list creation failed");
  const companies = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      createCompanyFixture({ name: `Company ${i}`, leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id }),
    ),
  );
  for (const c of companies) await testPrisma.company.update({ where: { id: c.id }, data: { phone: "555-0100" } });
  await addCompaniesToList(created.id, companies.map((c) => c.id));
  return { listId: created.id, companies };
}

describe("Calling session lifecycle", () => {
  it("starts a session snapshotting only eligible companies, skipping those missing a phone", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId, companies } = await callingListWithCompanies(user, leadType, stage, 1);
    const noPhone = await createCompanyFixture({ name: "No Phone Co", leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: null, createdById: user.id });
    await addCompaniesToList(listId, [noPhone.id]);

    const result = await startCallingSession(listId);
    expect(result).toHaveProperty("success", true);
    if (!("success" in result)) throw new Error("unreachable");

    const entries = await testPrisma.callingSessionEntry.findMany({ where: { sessionId: result.id } });
    expect(entries.map((e) => e.companyId)).toEqual([companies[0].id]);
  });

  it("refuses to start a second session while one is already active", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage);
    await startCallingSession(listId);

    const second = await startCallingSession(listId);
    expect(second).toHaveProperty("error");
  });

  it("pauses and resumes a session", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");

    await pauseCallingSession(started.id);
    expect((await testPrisma.callingSession.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("PAUSED");

    await resumeCallingSession(started.id);
    expect((await testPrisma.callingSession.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("ACTIVE");
  });

  it("ending a session early (with pending entries) marks it ENDED, not COMPLETED", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 2);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");

    await endCallingSession(started.id);
    expect((await testPrisma.callingSession.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("ENDED");
  });
});

describe("session ownership", () => {
  it("a different user cannot pause, resume, or end someone else's session", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");

    const otherRole = await createRoleWithPermissions("OtherCaller", ["use_calling_lists"]);
    const other = await createTestUser({ roleId: otherRole.id });
    await loginAs(other.id);

    await pauseCallingSession(started.id);
    expect((await testPrisma.callingSession.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("ACTIVE");
  });
});

describe("recordCallOutcome", () => {
  async function outcomeFixture(overrides: Partial<Parameters<typeof testPrisma.callOutcome.create>[0]["data"]> = {}) {
    return testPrisma.callOutcome.create({ data: { name: `Outcome ${Math.random()}`, ...overrides } });
  }

  it("creates a PHONE activity with the outcome and notes", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId, companies } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Spoke to Contact" });

    const result = await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "Had a great chat." });
    expect(result).toHaveProperty("success", true);

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: companies[0].id, type: "PHONE" } });
    expect(activity.outcome).toBe("Spoke to Contact");
    expect(activity.notes).toBe("Had a great chat.");

    const updatedEntry = await testPrisma.callingSessionEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(updatedEntry.status).toBe("COMPLETED");
  });

  it("creates the configured default follow-up task", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId, companies } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "No Answer", requiresNextAction: true, defaultNextActionDays: 2, defaultNextActionTitle: "Try again" });

    await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "" });

    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: companies[0].id } });
    expect(task.title).toBe("Try again");
    expect(task.assignedToId).toBe(user.id);
  });

  it("applies the configured pipeline-stage change and records the loss reason", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const lostStage = await createPipelineStageFixture("Lost", { outcomeType: "LOST" });
    const reason = await testPrisma.rejectionReason.create({ data: { name: "Not a fit" } });
    const { listId, companies } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Not Interested", requiresRejectionReason: true, defaultPipelineStageId: lostStage.id });

    const result = await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "", rejectionReasonId: reason.id });
    expect(result).toHaveProperty("success", true);

    const company = await testPrisma.company.findUniqueOrThrow({ where: { id: companies[0].id } });
    expect(company.pipelineStageId).toBe(lostStage.id);

    const history = await testPrisma.pipelineStageHistory.findFirstOrThrow({ where: { companyId: companies[0].id, toStageId: lostStage.id } });
    expect(history.lossReasonId).toBe(reason.id);
  });

  it("applies the do-not-contact restriction when configured", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId, companies } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Do Not Contact", appliesDoNotContact: true });

    await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "Asked to be removed." });

    const company = await testPrisma.company.findUniqueOrThrow({ where: { id: companies[0].id } });
    expect(company.doNotContact).toBe(true);
  });

  it("requires notes when the outcome is configured to require them", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Interested", requiresNotes: true });

    const result = await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "" });
    expect(result).toHaveProperty("error");
  });

  it("is idempotent — a retried submit for the same entry does not create a second activity", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId, companies } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Left Message" });

    const first = await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "" });
    const second = await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "" });
    expect(first).toHaveProperty("success", true);
    expect(second).toHaveProperty("success", true);

    const activities = await testPrisma.activity.findMany({ where: { companyId: companies[0].id, type: "PHONE" } });
    expect(activities).toHaveLength(1);
    const records = await testPrisma.callRecord.findMany({ where: { entryId: entry.id } });
    expect(records).toHaveLength(1);
  });

  it("skips an entry permanently without creating any activity", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId, companies } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });

    await skipEntryPermanently(started.id, entry.id);

    expect((await testPrisma.callingSessionEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe("SKIPPED");
    expect(await testPrisma.activity.count({ where: { companyId: companies[0].id } })).toBe(0);
  });

  it("reports opensEmailComposer so the UI knows to route to the composer instead of the next entry", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Send Information", opensEmailComposer: true });

    const result = await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "" });
    expect(result).toMatchObject({ success: true, opensEmailComposer: true });
  });

  it("refuses to record a call outcome while the session is paused", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "No Answer" });
    await pauseCallingSession(started.id);

    const result = await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "" });
    expect(result).toHaveProperty("error");
  });

  it("rejects recording a call outcome from a user without use_calling_lists", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "No Access" });

    const noAccessRole = await createRoleWithPermissions("NoCallingAccess", []);
    const noAccessUser = await createTestUser({ roleId: noAccessRole.id });
    await loginAs(noAccessUser.id);

    await expect(recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "" })).rejects.toThrow();
  });
});

describe("updateCallRecordNotes", () => {
  async function outcomeFixture(overrides: Partial<Parameters<typeof testPrisma.callOutcome.create>[0]["data"]> = {}) {
    return testPrisma.callOutcome.create({ data: { name: `Outcome ${Math.random()}`, ...overrides } });
  }

  it("revises a completed entry's notes and keeps the linked Activity in sync", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId, companies } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Spoke to Contact" });
    await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "Original note." });

    const result = await updateCallRecordNotes(started.id, entry.id, "Revised note.");
    expect(result).toHaveProperty("success", true);

    const record = await testPrisma.callRecord.findUniqueOrThrow({ where: { entryId: entry.id } });
    expect(record.notes).toBe("Revised note.");
    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: companies[0].id, type: "PHONE" } });
    expect(activity.notes).toBe("Revised note.");
  });

  it("refuses to revise an entry recorded with a skipRestOfSession outcome", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Do Not Call Again", skipRestOfSession: true });
    await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "Original note." });

    const result = await updateCallRecordNotes(started.id, entry.id, "Trying to sneak an edit in.");
    expect(result).toHaveProperty("error");
    expect((await testPrisma.callRecord.findUniqueOrThrow({ where: { entryId: entry.id } })).notes).toBe("Original note.");
  });

  it("enforces requiresNotes on a revision, same as the original recording", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Interested", requiresNotes: true });
    await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "Wants a demo." });

    const result = await updateCallRecordNotes(started.id, entry.id, "   ");
    expect(result).toHaveProperty("error");
  });

  it("refuses to revise a still-PENDING entry", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });

    const result = await updateCallRecordNotes(started.id, entry.id, "Can't edit this yet.");
    expect(result).toHaveProperty("error");
  });

  it("a different user cannot revise notes on someone else's session", async () => {
    const { user, leadType, stage } = await baseFixtures();
    await loginAs(user.id);
    const { listId } = await callingListWithCompanies(user, leadType, stage, 1);
    const started = await startCallingSession(listId);
    if (!("success" in started)) throw new Error("unreachable");
    const entry = await testPrisma.callingSessionEntry.findFirstOrThrow({ where: { sessionId: started.id } });
    const outcome = await outcomeFixture({ name: "Spoke to Contact" });
    await recordCallOutcome(started.id, entry.id, { outcomeId: outcome.id, notes: "Original note." });

    const otherRole = await createRoleWithPermissions("OtherReviser", ["use_calling_lists"]);
    const other = await createTestUser({ roleId: otherRole.id });
    await loginAs(other.id);

    const result = await updateCallRecordNotes(started.id, entry.id, "Hijacked note.");
    expect(result).toHaveProperty("error");
    expect((await testPrisma.callRecord.findUniqueOrThrow({ where: { entryId: entry.id } })).notes).toBe("Original note.");
  });
});
