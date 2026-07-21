import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { createAppointment, updateAppointment, cancelAppointment } from "../../src/lib/comms/appointments";
import { SIMULATED_CALENDAR_FAILURE_TITLE } from "../../src/lib/comms/providers/mock";

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

async function baseFixtures() {
  const role = await createRoleWithPermissions("Sender", ["manage_calendar_connections"]);
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

function slot() {
  return { startAt: new Date(Date.now() + 60 * 60 * 1000), endAt: new Date(Date.now() + 90 * 60 * 1000) };
}

describe("createAppointment", () => {
  it("rejects an end time at or before the start time", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const { startAt } = slot();

    const result = await createAppointment({
      userId: user.id,
      companyId: company.id,
      type: "DEMO",
      title: "Demo",
      startAt,
      endAt: startAt,
      timezone: "America/Toronto",
      attendeeEmails: [],
    });
    expect(result.ok).toBe(false);
    expect(await testPrisma.appointment.count()).toBe(0);
  });

  it("requires a connected mailbox", async () => {
    const { user, company } = await baseFixtures();
    const { startAt, endAt } = slot();

    const result = await createAppointment({
      userId: user.id,
      companyId: company.id,
      type: "DEMO",
      title: "Demo",
      startAt,
      endAt,
      timezone: "America/Toronto",
      attendeeEmails: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Connect a mailbox/);
  });

  it("creates the appointment and stores a real providerEventId on success", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const { startAt, endAt } = slot();

    const result = await createAppointment({
      userId: user.id,
      companyId: company.id,
      type: "DEMO",
      title: "Demo with Acme",
      startAt,
      endAt,
      timezone: "America/Toronto",
      attendeeEmails: ["lead@example.com"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const appointment = await testPrisma.appointment.findUniqueOrThrow({ where: { id: result.appointmentId } });
    expect(appointment.status).toBe("SCHEDULED");
    expect(appointment.providerEventId).toContain("mock-event-");
  });

  it("keeps an auditable ERROR row (never a fake providerEventId) when the provider call fails", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const { startAt, endAt } = slot();

    const result = await createAppointment({
      userId: user.id,
      companyId: company.id,
      type: "DEMO",
      title: SIMULATED_CALENDAR_FAILURE_TITLE,
      startAt,
      endAt,
      timezone: "America/Toronto",
      attendeeEmails: [],
    });
    expect(result.ok).toBe(false);

    const appointment = await testPrisma.appointment.findFirstOrThrow({ where: { companyId: company.id } });
    expect(appointment.status).toBe("ERROR");
    expect(appointment.providerEventId).toBeNull();
    expect(appointment.lastError).toMatch(/Simulated calendar provider failure/);
  });
});

describe("updateAppointment", () => {
  it("updates the stored fields and sets status UPDATED on success", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const { startAt, endAt } = slot();
    const created = await createAppointment({
      userId: user.id,
      companyId: company.id,
      type: "DEMO",
      title: "Demo",
      startAt,
      endAt,
      timezone: "America/Toronto",
      attendeeEmails: [],
    });
    if (!created.ok) throw new Error("create failed");

    const newStart = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
    const newEnd = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    const result = await updateAppointment(created.appointmentId, { startAt: newStart, endAt: newEnd });
    expect(result.ok).toBe(true);

    const appointment = await testPrisma.appointment.findUniqueOrThrow({ where: { id: created.appointmentId } });
    expect(appointment.status).toBe("UPDATED");
    expect(appointment.startAt.getTime()).toBe(newStart.getTime());
  });

  it("fails when the merged end time would no longer be after the start time", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const { startAt, endAt } = slot();
    const created = await createAppointment({
      userId: user.id,
      companyId: company.id,
      type: "DEMO",
      title: "Demo",
      startAt,
      endAt,
      timezone: "America/Toronto",
      attendeeEmails: [],
    });
    if (!created.ok) throw new Error("create failed");

    const result = await updateAppointment(created.appointmentId, { endAt: startAt });
    expect(result.ok).toBe(false);
  });
});

describe("cancelAppointment", () => {
  it("cancels a scheduled appointment", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const { startAt, endAt } = slot();
    const created = await createAppointment({
      userId: user.id,
      companyId: company.id,
      type: "DEMO",
      title: "Demo",
      startAt,
      endAt,
      timezone: "America/Toronto",
      attendeeEmails: [],
    });
    if (!created.ok) throw new Error("create failed");

    const result = await cancelAppointment(created.appointmentId);
    expect(result.ok).toBe(true);
    expect((await testPrisma.appointment.findUniqueOrThrow({ where: { id: created.appointmentId } })).status).toBe("CANCELLED");
  });

  it("is idempotent — cancelling an already-cancelled appointment is a no-op success", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const { startAt, endAt } = slot();
    const created = await createAppointment({
      userId: user.id,
      companyId: company.id,
      type: "DEMO",
      title: "Demo",
      startAt,
      endAt,
      timezone: "America/Toronto",
      attendeeEmails: [],
    });
    if (!created.ok) throw new Error("create failed");

    await cancelAppointment(created.appointmentId);
    const second = await cancelAppointment(created.appointmentId);
    expect(second.ok).toBe(true);
  });
});
