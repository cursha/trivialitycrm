import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createPipelineStageFixture, createLeadTypeFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import {
  createCallOutcome,
  renameCallOutcome,
  setCallOutcomeActive,
  deleteCallOutcome,
  updateCallOutcomeConfig,
} from "../../src/app/(dashboard)/settings/call-outcomes/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) formData.set(k, v);
  return formData;
}

describe("Call Outcome admin CRUD", () => {
  it("creates, renames, deactivates, and configures a call outcome", async () => {
    const role = await createRoleWithPermissions("OutcomeAdmin", ["manage_call_outcomes"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const stage = await createPipelineStageFixture("Lost Stage", { outcomeType: "LOST" });

    await createCallOutcome(undefined, fd({ name: "Custom Outcome" }));
    const outcome = await testPrisma.callOutcome.findFirstOrThrow({ where: { name: "Custom Outcome" } });
    expect(outcome.active).toBe(true);

    await renameCallOutcome(outcome.id, fd({ name: "Renamed Outcome" }));
    expect((await testPrisma.callOutcome.findUniqueOrThrow({ where: { id: outcome.id } })).name).toBe("Renamed Outcome");

    await setCallOutcomeActive(outcome.id, false);
    expect((await testPrisma.callOutcome.findUniqueOrThrow({ where: { id: outcome.id } })).active).toBe(false);

    await updateCallOutcomeConfig(
      outcome.id,
      fd({
        requiresNotes: "on",
        requiresNextAction: "on",
        defaultNextActionDays: "3",
        defaultNextActionTitle: "Follow up",
        defaultPipelineStageId: stage.id,
        requiresRejectionReason: "on",
        skipRestOfSession: "on",
        resultCategory: "NOT_INTERESTED",
      }),
    );
    const configured = await testPrisma.callOutcome.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(configured).toMatchObject({
      requiresNotes: true,
      requiresNextAction: true,
      defaultNextActionDays: 3,
      defaultNextActionTitle: "Follow up",
      defaultPipelineStageId: stage.id,
      requiresRejectionReason: true,
      skipRestOfSession: true,
      resultCategory: "NOT_INTERESTED",
    });
  });

  it("requires a default-next-action day count when requiresNextAction is checked", async () => {
    const role = await createRoleWithPermissions("OutcomeAdmin2", ["manage_call_outcomes"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    await createCallOutcome(undefined, fd({ name: "Needs Days" }));
    const outcome = await testPrisma.callOutcome.findFirstOrThrow({ where: { name: "Needs Days" } });

    const result = await updateCallOutcomeConfig(outcome.id, fd({ requiresNextAction: "on" }));
    expect(result).toHaveProperty("error");
  });

  it("refuses to delete an outcome that has been used to record a call", async () => {
    const role = await createRoleWithPermissions("OutcomeAdmin3", ["manage_call_outcomes"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    await createCallOutcome(undefined, fd({ name: "Used Outcome" }));
    const outcome = await testPrisma.callOutcome.findFirstOrThrow({ where: { name: "Used Outcome" } });

    // Simulate prior usage directly (full call-recording flow is exercised
    // in calling-session.test.ts) — this test only proves the deletion
    // guard itself.
    const list = await testPrisma.salesList.create({ data: { name: "L", purpose: "CALLING", type: "FIXED", ownerId: user.id } });
    const session = await testPrisma.callingSession.create({
      data: { listId: list.id, startedById: user.id, orderBy: "name", orderDir: "asc" },
    });
    const leadType = await createLeadTypeFixture();
    const companyStage = await createPipelineStageFixture();
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: companyStage.id, assignedToId: null, createdById: user.id });
    const entry = await testPrisma.callingSessionEntry.create({ data: { sessionId: session.id, companyId: company.id, position: 0 } });
    await testPrisma.callRecord.create({
      data: { sessionId: session.id, entryId: entry.id, companyId: company.id, outcomeId: outcome.id, recordedById: user.id },
    });

    const result = await deleteCallOutcome(outcome.id);
    expect(result).toHaveProperty("error");
    expect(await testPrisma.callOutcome.findUnique({ where: { id: outcome.id } })).not.toBeNull();
  });

  it("rejects call-outcome management from a user without manage_call_outcomes", async () => {
    const role = await createRoleWithPermissions("NoOutcomeAccess", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(createCallOutcome(undefined, fd({ name: "Should Fail" }))).rejects.toThrow();
  });
});
