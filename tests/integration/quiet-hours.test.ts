import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { sendEmail, scheduleEmail, processDueScheduledEmail } from "../../src/lib/comms/send-email";
import { enrollInSequence, processDueSequenceStep } from "../../src/lib/comms/sequences";
import { zonedHour, BUSINESS_TIMEZONE } from "../../src/lib/timezone";

const TEST_KEY = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const UNSUBSCRIBE_BODY = "Thanks for your interest. Unsubscribe: {{unsubscribeLink}}";
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
  mutableEnv.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  mutableEnv.UNSUBSCRIBE_TOKEN_SECRET = TEST_KEY;
  resetEnvCacheForTests();
});

afterEach(() => {
  delete mutableEnv.TOKEN_ENCRYPTION_KEY;
  delete mutableEnv.UNSUBSCRIBE_TOKEN_SECRET;
  resetEnvCacheForTests();
});

/** A one-hour window guaranteed to contain the current real moment — avoids
 * fake-timer complexity (see tests/unit/quiet-hours.test.ts for the pure
 * wrap-around/DST-adjacent math, tested with fixed reference instants). */
async function setQuietHoursIncludingNow() {
  const hour = zonedHour(new Date(), BUSINESS_TIMEZONE);
  await testPrisma.workspaceSettings.upsert({
    where: { id: 1 },
    update: { quietHoursStartHour: hour, quietHoursEndHour: (hour + 1) % 24 },
    create: { id: 1, quietHoursStartHour: hour, quietHoursEndHour: (hour + 1) % 24 },
  });
}

async function setQuietHoursExcludingNow() {
  const hour = zonedHour(new Date(), BUSINESS_TIMEZONE);
  const farStart = (hour + 3) % 24;
  const farEnd = (hour + 4) % 24;
  await testPrisma.workspaceSettings.upsert({
    where: { id: 1 },
    update: { quietHoursStartHour: farStart, quietHoursEndHour: farEnd },
    create: { id: 1, quietHoursStartHour: farStart, quietHoursEndHour: farEnd },
  });
}

async function baseFixtures() {
  const role = await createRoleWithPermissions("Sender", ["send_email", "schedule_email", "enroll_in_sequences"]);
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
      scopes: ["Mail.Send"],
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "CONNECTED",
    },
  });
}

async function permittedContactFixture(companyId: string) {
  return testPrisma.contact.create({
    data: { companyId, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
  });
}

describe("quiet hours — CRM outreach send paths", () => {
  it("has no effect when disabled (both fields null, the default)", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(true);
  });

  it("blocks an immediate send during the configured window", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    await setQuietHoursIncludingNow();

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/quiet hours/i);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("allows an immediate send outside the configured window", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    await setQuietHoursExcludingNow();

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(true);
  });

  it("defers a due scheduled send during the window — stays SCHEDULED with scheduledFor pushed later, not FAILED", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    const scheduled = await scheduleEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi",
      body: UNSUBSCRIBE_BODY,
      scheduledFor: new Date(Date.now() - 1000),
    });
    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) return;

    await setQuietHoursIncludingNow();
    const before = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });

    await processDueScheduledEmail(scheduled.emailMessageId);

    const after = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(after.status).toBe("SCHEDULED");
    expect(after.scheduledFor!.getTime()).toBeGreaterThan(before.scheduledFor!.getTime());
  });

  it("sends a due scheduled email normally outside the window", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    const scheduled = await scheduleEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi",
      body: UNSUBSCRIBE_BODY,
      scheduledFor: new Date(Date.now() - 1000),
    });
    if (!scheduled.ok) throw new Error("expected schedule to succeed");
    await setQuietHoursExcludingNow();

    await processDueScheduledEmail(scheduled.emailMessageId);

    const after = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(after.status).toBe("SENT");
  });

  it("defers a due EMAIL sequence step during the window — no SequenceStepRun created, enrollment stays due (not FAILED)", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    const template = await testPrisma.emailTemplate.create({
      data: { name: "Intro", subject: "Hi {{contact.firstName}}", body: UNSUBSCRIBE_BODY, visibility: "SHARED", active: true, createdById: user.id },
    });
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "EMAIL", emailTemplateId: template.id } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, contactId: contact.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("expected enroll to succeed");

    await setQuietHoursIncludingNow();
    await processDueSequenceStep(enrolled.enrollmentId, step.id);

    expect(await testPrisma.sequenceStepRun.count()).toBe(0);
    const enrollment = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    expect(enrollment.status).toBe("ACTIVE");
    expect(enrollment.currentStepOrder).toBe(1); // never advanced — still due, will be re-offered next tick
  });

  it("runs a due EMAIL sequence step normally outside the window", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    const template = await testPrisma.emailTemplate.create({
      data: { name: "Intro", subject: "Hi {{contact.firstName}}", body: UNSUBSCRIBE_BODY, visibility: "SHARED", active: true, createdById: user.id },
    });
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "EMAIL", emailTemplateId: template.id } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, contactId: contact.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("expected enroll to succeed");

    await setQuietHoursExcludingNow();
    await processDueSequenceStep(enrolled.enrollmentId, step.id);

    const run = await testPrisma.sequenceStepRun.findUniqueOrThrow({ where: { enrollmentId_stepId: { enrollmentId: enrolled.enrollmentId, stepId: step.id } } });
    expect(run.status).toBe("SUCCEEDED");
  });
});
