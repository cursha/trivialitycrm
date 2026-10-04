import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import {
  createRoleWithPermissions,
  createTestUser,
  createLeadTypeFixture,
  createPipelineStageFixture,
  createCompanyFixture,
  createRejectionReasonFixture,
  loginAs,
} from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { logVisit } from "../../src/app/(dashboard)/companies/[id]/activities/actions";
import { updateBarIntel } from "../../src/app/(dashboard)/companies/[id]/bar-intel/actions";

const TEST_KEY = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  mutableEnv.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  resetEnvCacheForTests();
});

afterEach(() => {
  delete mutableEnv.TOKEN_ENCRYPTION_KEY;
  resetEnvCacheForTests();
});

const REP_PERMISSIONS = ["view_assigned_leads", "edit_leads", "manage_calendar_connections"];

async function setup(permissions: string[] = REP_PERMISSIONS) {
  const role = await createRoleWithPermissions("Rep", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const newStage = await createPipelineStageFixture("New", { isDefault: true });
  const lostStage = await createPipelineStageFixture("Lost", { outcomeType: "LOST" });
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: newStage.id, assignedToId: user.id, createdById: user.id });
  await loginAs(user.id);

  const flyer = await testPrisma.callOutcome.create({
    data: {
      name: "Flyer Dropped (Owner Not In)",
      appliesToCalls: false,
      appliesToVisits: true,
      requiresNextAction: true,
      defaultNextActionDays: 2,
      defaultNextActionTitle: "Call to book a demo",
    },
  });
  const demoBooked = await testPrisma.callOutcome.create({ data: { name: "Demo Booked", appliesToCalls: false, appliesToVisits: true, booksDemo: true } });
  const notFit = await testPrisma.callOutcome.create({
    data: {
      name: "Closed / Not a Fit",
      appliesToCalls: false,
      appliesToVisits: true,
      requiresNotes: true,
      requiresRejectionReason: true,
      defaultPipelineStageId: lostStage.id,
    },
  });
  const callOnly = await testPrisma.callOutcome.create({ data: { name: "No Answer", appliesToCalls: true, appliesToVisits: false } });

  return { user, company, leadType, newStage, lostStage, outcomes: { flyer, demoBooked, notFit, callOnly } };
}

function visitForm(fields: Record<string, string>): FormData {
  const formData = new FormData();
  formData.set("timezone", "America/Denver");
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

async function connectMailbox(userId: string) {
  return testPrisma.providerConnection.create({
    data: {
      userId,
      provider: "TITAN",
      providerAccountEmail: "rep@example.test",
      encryptedAccessToken: encryptToken("mailbox-password"),
      scopes: [],
      status: "CONNECTED",
    },
  });
}

describe("logVisit", () => {
  it("logs a VISIT activity linked to its outcome and creates the outcome's follow-up", async () => {
    const { user, company, outcomes } = await setup();

    const result = await logVisit(company.id, visitForm({ outcomeId: outcomes.flyer.id, notes: "Bartender says owner is in Tue after 2", occurredAt: "2026-10-06T15:10" }));
    expect(result).toEqual({ ok: true, demoBooked: false, inviteSent: false });

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id } });
    expect(activity.type).toBe("VISIT");
    expect(activity.outcome).toBe("Flyer Dropped (Owner Not In)");
    expect(activity.callOutcomeId).toBe(outcomes.flyer.id);
    expect(activity.userId).toBe(user.id);
    // 3:10pm MDT is 21:10 UTC.
    expect(activity.occurredAt.toISOString()).toBe("2026-10-06T21:10:00.000Z");

    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.title).toBe("Call to book a demo");
    expect(task.assignedToId).toBe(user.id);
  });

  it("only offers visit outcomes — a calls-only outcome is refused", async () => {
    const { company, outcomes } = await setup();
    const result = await logVisit(company.id, visitForm({ outcomeId: outcomes.callOnly.id }));
    expect(result).toEqual({ error: "Choose a valid visit outcome." });
    expect(await testPrisma.activity.count()).toBe(0);
  });

  it("enforces required notes and reason, then moves the company to the outcome's stage with the loss reason", async () => {
    const { company, outcomes, lostStage } = await setup();
    const reason = await createRejectionReasonFixture("Closed");

    expect(await logVisit(company.id, visitForm({ outcomeId: outcomes.notFit.id, rejectionReasonId: reason.id }))).toEqual({
      error: "Notes are required for this outcome.",
    });
    expect(await logVisit(company.id, visitForm({ outcomeId: outcomes.notFit.id, notes: "Boarded up" }))).toEqual({
      error: "Choose a reason for this outcome.",
    });

    const result = await logVisit(company.id, visitForm({ outcomeId: outcomes.notFit.id, notes: "Boarded up", rejectionReasonId: reason.id }));
    expect(result).toMatchObject({ ok: true });

    const updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.pipelineStageId).toBe(lostStage.id);
    const history = await testPrisma.pipelineStageHistory.findFirstOrThrow({ where: { companyId: company.id, toStageId: lostStage.id } });
    expect(history.lossReasonId).toBe(reason.id);
  });

  it("fills in bar intel but never clears it from a blank field", async () => {
    const { company, outcomes } = await setup();

    await logVisit(company.id, visitForm({ outcomeId: outcomes.flyer.id, slowNight: "TUESDAY", slowNightHeadcount: "12", currentEntertainment: "Karaoke Thursdays" }));
    let updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated).toMatchObject({ slowNight: "TUESDAY", slowNightHeadcount: 12, currentEntertainment: "Karaoke Thursdays" });

    await logVisit(company.id, visitForm({ outcomeId: outcomes.flyer.id, slowNight: "", slowNightHeadcount: "", currentEntertainment: "" }));
    updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated).toMatchObject({ slowNight: "TUESDAY", slowNightHeadcount: 12, currentEntertainment: "Karaoke Thursdays" });

    await logVisit(company.id, visitForm({ outcomeId: outcomes.flyer.id, slowNight: "MONDAY" }));
    updated = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.slowNight).toBe("MONDAY");
  });

  it("rejects an invalid headcount before writing anything", async () => {
    const { company, outcomes } = await setup();
    const result = await logVisit(company.id, visitForm({ outcomeId: outcomes.flyer.id, slowNightHeadcount: "lots" }));
    expect("error" in result && result.error).toMatch(/whole number/);
    expect(await testPrisma.activity.count()).toBe(0);
  });

  it("books the demo in the rep's own timezone — CRM-only when no mailbox is connected", async () => {
    const { company, outcomes } = await setup();
    const owner = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Sam", lastName: "Owner", email: "sam@example.test", isDecisionMaker: true },
    });

    const result = await logVisit(
      company.id,
      visitForm({ outcomeId: outcomes.demoBooked.id, demoStartAt: "2026-10-08T14:00", demoDurationMinutes: "20", demoContactId: owner.id, sendInvite: "on" }),
    );
    expect(result).toEqual({ ok: true, demoBooked: true, inviteSent: false });

    const appointment = await testPrisma.appointment.findFirstOrThrow({ where: { companyId: company.id } });
    expect(appointment.type).toBe("DEMO");
    expect(appointment.title).toBe(`Triviality demo: ${company.name}`);
    expect(appointment.startAt.toISOString()).toBe("2026-10-08T20:00:00.000Z");
    expect(appointment.endAt.toISOString()).toBe("2026-10-08T20:20:00.000Z");
    expect(appointment.timezone).toBe("America/Denver");
    expect(appointment.contactId).toBe(owner.id);
    expect(appointment.location).toBe("Testville, ON");
    expect(appointment.providerEventId).toBeNull();

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id } });
    expect(activity.outcome).toBe("Demo Booked");
  });

  it("sends the invite through a connected mailbox, to the contact", async () => {
    const { user, company, outcomes } = await setup();
    await connectMailbox(user.id);
    const owner = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Sam", lastName: "Owner", email: "sam@example.test" } });

    const result = await logVisit(
      company.id,
      visitForm({ outcomeId: outcomes.demoBooked.id, demoStartAt: "2026-10-08T14:00", demoContactId: owner.id, sendInvite: "on" }),
    );
    expect(result).toEqual({ ok: true, demoBooked: true, inviteSent: true });

    const appointment = await testPrisma.appointment.findFirstOrThrow({ where: { companyId: company.id } });
    expect(appointment.attendeeEmails).toEqual(["sam@example.test"]);
    expect(appointment.providerEventId).not.toBeNull();
  });

  it("never invites a do-not-contact contact", async () => {
    const { user, company, outcomes } = await setup();
    await connectMailbox(user.id);
    const owner = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Sam", lastName: "Owner", email: "sam@example.test", doNotContact: true },
    });

    await logVisit(company.id, visitForm({ outcomeId: outcomes.demoBooked.id, demoStartAt: "2026-10-08T14:00", demoContactId: owner.id, sendInvite: "on" }));
    const appointment = await testPrisma.appointment.findFirstOrThrow({ where: { companyId: company.id } });
    expect(appointment.attendeeEmails).toEqual([]);
  });

  it("requires a demo time, and refuses a contact from another company, before writing anything", async () => {
    const { user, company, leadType, newStage, outcomes } = await setup();
    const other = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: newStage.id, assignedToId: user.id, createdById: user.id });
    const stranger = await testPrisma.contact.create({ data: { companyId: other.id, firstName: "Not", lastName: "Here" } });

    expect(await logVisit(company.id, visitForm({ outcomeId: outcomes.demoBooked.id }))).toEqual({ error: "Enter the demo date and time." });
    expect(await logVisit(company.id, visitForm({ outcomeId: outcomes.demoBooked.id, demoStartAt: "2026-10-08T14:00", demoContactId: stranger.id }))).toEqual({
      error: "Choose a contact from this company for the demo.",
    });
    expect(await testPrisma.activity.count()).toBe(0);
    expect(await testPrisma.appointment.count()).toBe(0);
  });

  it("refuses to book a demo without the appointment permission", async () => {
    const { company, outcomes } = await setup(["view_assigned_leads", "edit_leads"]);
    const result = await logVisit(company.id, visitForm({ outcomeId: outcomes.demoBooked.id, demoStartAt: "2026-10-08T14:00" }));
    expect("error" in result && result.error).toMatch(/permission to book appointments/);
    expect(await testPrisma.activity.count()).toBe(0);
  });

  it("is scoped to the rep's own companies and refuses archived ones", async () => {
    const { company, leadType, newStage, outcomes } = await setup();
    const otherRole = await createRoleWithPermissions("Other rep", REP_PERMISSIONS);
    const otherRep = await createTestUser({ roleId: otherRole.id });
    const theirs = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: newStage.id, assignedToId: otherRep.id, createdById: otherRep.id });
    const archived = await testPrisma.company.update({ where: { id: company.id }, data: { status: "ARCHIVED" } });

    expect(await logVisit(theirs.id, visitForm({ outcomeId: outcomes.flyer.id }))).toEqual({ error: "You do not have access to this company." });
    expect(await logVisit(archived.id, visitForm({ outcomeId: outcomes.flyer.id }))).toEqual({ error: "You do not have access to this company." });
    expect(await testPrisma.activity.count()).toBe(0);
  });

  it("requires edit permission", async () => {
    const { company, outcomes } = await setup(["view_assigned_leads"]);
    await expect(logVisit(company.id, visitForm({ outcomeId: outcomes.flyer.id }))).rejects.toThrow();
  });
});

describe("updateBarIntel", () => {
  it("saves and clears bar intel", async () => {
    const { company } = await setup();

    const save = new FormData();
    save.set("slowNight", "WEDNESDAY");
    save.set("slowNightHeadcount", "20");
    save.set("currentEntertainment", "Nothing midweek");
    expect(await updateBarIntel(company.id, save)).toBeUndefined();
    expect(await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).toMatchObject({
      slowNight: "WEDNESDAY",
      slowNightHeadcount: 20,
      currentEntertainment: "Nothing midweek",
    });

    const clear = new FormData();
    clear.set("slowNight", "");
    clear.set("slowNightHeadcount", "");
    clear.set("currentEntertainment", "");
    expect(await updateBarIntel(company.id, clear)).toBeUndefined();
    expect(await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } })).toMatchObject({
      slowNight: null,
      slowNightHeadcount: null,
      currentEntertainment: null,
    });
  });

  it("rejects an unknown weekday", async () => {
    const { company } = await setup();
    const form = new FormData();
    form.set("slowNight", "FUNDAY");
    const result = await updateBarIntel(company.id, form);
    expect(result?.error).toBeTruthy();
  });
});
