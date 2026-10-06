import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createActivity, logVisit } from "../../src/app/(dashboard)/companies/[id]/activities/actions";
import { createTask } from "../../src/app/(dashboard)/companies/[id]/tasks/actions";
import { listCompanyActivities } from "../../src/app/(dashboard)/companies/queries";
import { getUserById } from "../../src/lib/auth/current-user";
import { dueDateFromInput, formatDueDate } from "../../src/lib/dates";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function setup() {
  const role = await createRoleWithPermissions("Rep", ["view_assigned_leads", "edit_leads"]);
  const owner = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("Target", { isDefault: true });
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: owner.id, createdById: owner.id });
  return { owner, company };
}

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

describe("due dates from a date input", () => {
  it("store at noon UTC so the picked day shows as that day in North America", () => {
    const due = dueDateFromInput("2026-10-09");
    expect(due.toISOString()).toBe("2026-10-09T12:00:00.000Z");
    expect(due.toLocaleDateString("en-CA", { timeZone: "America/Toronto" })).toBe("2026-10-09");
    expect(due.toLocaleDateString("en-CA", { timeZone: "America/Denver" })).toBe("2026-10-09");
    expect(formatDueDate(due, { year: "numeric", month: "2-digit", day: "2-digit" })).toBe(
      due.toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }),
    );
  });

  it("apply to follow-ups added from the follow-ups panel too", async () => {
    const { owner, company } = await setup();
    await loginAs(owner.id);
    await createTask(company.id, undefined, form({ title: "Call back", dueAt: "2026-10-09", assignedToId: owner.id }));
    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.dueAt.toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });
});

describe("Log activity with a follow-up date", () => {
  it("creates a follow-up linked to the activity, for the company's owner, with a default title", async () => {
    const { owner, company } = await setup();
    await loginAs(owner.id);

    const result = await createActivity(company.id, undefined, form({ type: "PHONE", notes: "Owner wants pricing", followUpAt: "2026-10-09" }));
    expect(result).toBeUndefined();

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id } });
    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.activityId).toBe(activity.id);
    expect(task.title).toBe("Follow up: Phone call");
    expect(task.assignedToId).toBe(owner.id);
    expect(task.status).toBe("OPEN");
    expect(task.dueAt.toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });

  it("uses the title given, and assigns to whoever logged it when the company has no owner", async () => {
    const { company } = await setup();
    await testPrisma.company.update({ where: { id: company.id }, data: { assignedToId: null } });
    const role = await createRoleWithPermissions("Manager", ["view_all_leads", "edit_leads"]);
    const manager = await createTestUser({ roleId: role.id });
    await loginAs(manager.id);

    await createActivity(company.id, undefined, form({ type: "MEETING", followUpAt: "2026-10-12", followUpTitle: "Send the contract" }));

    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.title).toBe("Send the contract");
    expect(task.assignedToId).toBe(manager.id);
  });

  it("creates no follow-up when no date is given", async () => {
    const { owner, company } = await setup();
    await loginAs(owner.id);
    await createActivity(company.id, undefined, form({ type: "EMAIL", followUpTitle: "ignored without a date" }));
    expect(await testPrisma.activity.count({ where: { companyId: company.id } })).toBe(1);
    expect(await testPrisma.task.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("rejects a malformed date and writes nothing", async () => {
    const { owner, company } = await setup();
    await loginAs(owner.id);
    const result = await createActivity(company.id, undefined, form({ type: "PHONE", followUpAt: "next tuesday" }));
    expect(result?.error).toBe("Choose a valid follow-up date.");
    expect(await testPrisma.activity.count({ where: { companyId: company.id } })).toBe(0);
    expect(await testPrisma.task.count({ where: { companyId: company.id } })).toBe(0);
  });

  it("shows the follow-up on its activity in the timeline, and keeps it if the activity is removed", async () => {
    const { owner, company } = await setup();
    await loginAs(owner.id);
    await createActivity(company.id, undefined, form({ type: "PHONE", followUpAt: "2026-10-09" }));
    await createActivity(company.id, undefined, form({ type: "NOTE", notes: "No follow-up on this one" }));

    const user = await getUserById(owner.id);
    const timeline = await listCompanyActivities(user!, company.id);
    const phone = timeline.find((a) => a.type === "PHONE")!;
    const note = timeline.find((a) => a.type === "NOTE")!;
    expect(phone.followUps).toEqual([{ id: expect.any(String), title: "Follow up: Phone call", dueAt: new Date("2026-10-09T12:00:00Z"), status: "OPEN" }]);
    expect(note.followUps).toEqual([]);
    expect(phone.user).toEqual({ name: owner.name });

    await testPrisma.activity.delete({ where: { id: phone.id } });
    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.activityId).toBeNull();
  });
});

describe("visit outcome follow-ups", () => {
  it("link to the visit they came from", async () => {
    const { owner, company } = await setup();
    await loginAs(owner.id);
    const flyer = await testPrisma.callOutcome.create({
      data: { name: "Flyer Dropped", appliesToCalls: false, appliesToVisits: true, requiresNextAction: true, defaultNextActionDays: 2, defaultNextActionTitle: "Call to book a demo" },
    });

    const visitForm = form({ outcomeId: flyer.id, timezone: "America/Toronto" });
    expect(await logVisit(company.id, visitForm)).toEqual({ ok: true, demoBooked: false, inviteSent: false });

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id, type: "VISIT" } });
    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.activityId).toBe(activity.id);
  });
});
