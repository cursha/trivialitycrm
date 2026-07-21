import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { scheduleAppointmentAction, cancelAppointmentAction } from "../../src/app/(dashboard)/companies/[id]/appointments/actions";

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

async function baseFixtures(permissions: string[] = ["manage_calendar_connections", "view_assigned_leads"]) {
  const role = await createRoleWithPermissions("Sender", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
  return { user, company };
}

async function connectMailbox(userId: string) {
  return testPrisma.providerConnection.create({
    data: {
      userId,
      provider: "MICROSOFT",
      providerAccountEmail: "salesperson@example.test",
      encryptedAccessToken: encryptToken("real-access-token"),
      encryptedRefreshToken: encryptToken("real-refresh-token"),
      scopes: ["Calendars.ReadWrite"],
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "CONNECTED",
    },
  });
}

function isoSlot() {
  return {
    startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16),
    endAt: new Date(Date.now() + 90 * 60 * 1000).toISOString().slice(0, 16),
  };
}

describe("scheduleAppointmentAction", () => {
  it("requires manage_calendar_connections", async () => {
    const { user, company } = await baseFixtures(["view_assigned_leads"]);
    await connectMailbox(user.id);
    await loginAs(user.id);
    const { startAt, endAt } = isoSlot();

    const formData = new FormData();
    formData.set("type", "DEMO");
    formData.set("title", "Demo");
    formData.set("startAt", startAt);
    formData.set("endAt", endAt);
    formData.set("timezone", "America/Toronto");

    await expect(scheduleAppointmentAction(company.id, undefined, formData)).rejects.toThrow(/Forbidden/);
  });

  it("rejects an invalid timezone before ever reaching the provider", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    await loginAs(user.id);
    const { startAt, endAt } = isoSlot();

    const formData = new FormData();
    formData.set("type", "DEMO");
    formData.set("title", "Demo");
    formData.set("startAt", startAt);
    formData.set("endAt", endAt);
    formData.set("timezone", "Not/A/Real/Zone");

    const result = await scheduleAppointmentAction(company.id, undefined, formData);
    expect(result?.error).toMatch(/valid timezone/);
    expect(await testPrisma.appointment.count()).toBe(0);
  });

  it("schedules a real appointment end to end through the action layer", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    await loginAs(user.id);
    const { startAt, endAt } = isoSlot();

    const formData = new FormData();
    formData.set("type", "TRIAL_REVIEW");
    formData.set("title", "Trial review with Acme");
    formData.set("startAt", startAt);
    formData.set("endAt", endAt);
    formData.set("timezone", "America/Toronto");
    formData.set("attendeeEmails", "lead@example.com, manager@example.com");

    const result = await scheduleAppointmentAction(company.id, undefined, formData);
    expect(result).toBeUndefined();

    const appointment = await testPrisma.appointment.findFirstOrThrow({ where: { companyId: company.id } });
    expect(appointment.type).toBe("TRIAL_REVIEW");
    expect(appointment.attendeeEmails).toEqual(["lead@example.com", "manager@example.com"]);
    expect(appointment.providerEventId).toContain("mock-event-");
  });
});

describe("cancelAppointmentAction", () => {
  it("is scoped to companies the caller can access", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    await loginAs(user.id);
    const { startAt, endAt } = isoSlot();

    const formData = new FormData();
    formData.set("type", "DEMO");
    formData.set("title", "Demo");
    formData.set("startAt", startAt);
    formData.set("endAt", endAt);
    formData.set("timezone", "America/Toronto");
    await scheduleAppointmentAction(company.id, undefined, formData);
    const appointment = await testPrisma.appointment.findFirstOrThrow({ where: { companyId: company.id } });

    const outsiderRole = await createRoleWithPermissions("Outsider", ["manage_calendar_connections", "view_assigned_leads"]);
    const outsider = await createTestUser({ roleId: outsiderRole.id });
    await loginAs(outsider.id);

    await expect(cancelAppointmentAction(company.id, appointment.id)).rejects.toThrow(/Forbidden/);
  });
});
