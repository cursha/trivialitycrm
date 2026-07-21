import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { enrollInSequence, processDueSequenceStep, pauseEnrollment, resumeEnrollment, cancelEnrollment } from "../../src/lib/comms/sequences";
import { runSequenceTick } from "../../worker/handlers/sequence-tick";
import { enrollCompanyInSequence } from "../../src/app/(dashboard)/companies/[id]/sequences/actions";
import { SIMULATED_SEND_FAILURE_ADDRESS } from "../../src/lib/comms/providers/mock";

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

async function baseFixtures() {
  const role = await createRoleWithPermissions("Sender", ["enroll_in_sequences", "manage_sequences", "send_email", "edit_leads"]);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  const wonStage = await createPipelineStageFixture("Won", { outcomeType: "WON" });
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
  return { user, company, stage, wonStage };
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

async function sharedTemplateFixture(userId: string) {
  return testPrisma.emailTemplate.create({
    data: {
      name: "Intro",
      subject: "Hi {{contact.firstName}}",
      body: UNSUBSCRIBE_BODY,
      visibility: "SHARED",
      active: true,
      createdById: userId,
    },
  });
}

describe("enrollInSequence", () => {
  it("rejects enrolling in an inactive sequence", async () => {
    const { user, company } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", active: false, createdById: user.id } });

    const result = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    expect(result.ok).toBe(false);
  });

  it("requires a contact when the sequence has an EMAIL step", async () => {
    const { user, company } = await baseFixtures();
    const template = await sharedTemplateFixture(user.id);
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "EMAIL", emailTemplateId: template.id } });

    const result = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/choose a contact/i);
  });

  it("blocks a duplicate active enrollment for the same company+sequence", async () => {
    const { user, company } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "TASK", taskTitle: "Call" } });

    await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    const second = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    expect(second.ok).toBe(false);
  });

  it("computes the initial due date by folding a leading WAIT step's days", async () => {
    const { user, company } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "WAIT", waitDays: 2 } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 2, type: "TASK", taskTitle: "Call" } });

    const result = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const enrollment = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: result.enrollmentId } });
    expect(enrollment.currentStepOrder).toBe(2);
    const daysUntilDue = (enrollment.nextStepDueAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilDue).toBeGreaterThan(1.9);
    expect(daysUntilDue).toBeLessThan(2.1);
  });
});

describe("processDueSequenceStep", () => {
  it("sends an EMAIL step via the same consent-gated sendEmail(), then advances to the next step", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
    });
    const template = await sharedTemplateFixture(user.id);
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step1 = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "EMAIL", emailTemplateId: template.id } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 2, type: "TASK", taskTitle: "Follow up call" } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, contactId: contact.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await processDueSequenceStep(enrolled.enrollmentId, step1.id);

    const run = await testPrisma.sequenceStepRun.findUniqueOrThrow({ where: { enrollmentId_stepId: { enrollmentId: enrolled.enrollmentId, stepId: step1.id } } });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.emailMessageId).not.toBeNull();

    const emailMessage = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: run.emailMessageId! } });
    expect(emailMessage.status).toBe("SENT");
    expect(emailMessage.subject).toBe("Hi Jamie");

    const enrollment = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    expect(enrollment.currentStepOrder).toBe(2);
    expect(enrollment.status).toBe("ACTIVE");
  });

  it("records a failed EMAIL step and notifies the enroller, but still advances the sequence", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: SIMULATED_SEND_FAILURE_ADDRESS, emailPermitted: true },
    });
    const template = await sharedTemplateFixture(user.id);
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step1 = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "EMAIL", emailTemplateId: template.id } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 2, type: "TASK", taskTitle: "Follow up call" } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, contactId: contact.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await processDueSequenceStep(enrolled.enrollmentId, step1.id);

    const run = await testPrisma.sequenceStepRun.findUniqueOrThrow({ where: { enrollmentId_stepId: { enrollmentId: enrolled.enrollmentId, stepId: step1.id } } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toMatch(/Simulated provider failure/);

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { userId: user.id, type: "DELIVERY_FAILURE" } });
    expect((notification.payload as { enrollmentId: string }).enrollmentId).toBe(enrolled.enrollmentId);

    // The sequence still advances despite the failed step — a one-off
    // delivery failure doesn't kill an otherwise-healthy campaign.
    const enrollment = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    expect(enrollment.currentStepOrder).toBe(2);
    expect(enrollment.status).toBe("ACTIVE");
  });

  it("fails an EMAIL step whose template has been deactivated since the sequence was authored", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
    });
    const template = await sharedTemplateFixture(user.id);
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step1 = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "EMAIL", emailTemplateId: template.id } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, contactId: contact.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await testPrisma.emailTemplate.update({ where: { id: template.id }, data: { active: false } });
    await processDueSequenceStep(enrolled.enrollmentId, step1.id);

    const run = await testPrisma.sequenceStepRun.findUniqueOrThrow({ where: { enrollmentId_stepId: { enrollmentId: enrolled.enrollmentId, stepId: step1.id } } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toMatch(/deactivated/);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("creates a real Task for a TASK-like step", async () => {
    const { user, company } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step1 = await testPrisma.sequenceStep.create({
      data: { sequenceId: sequence.id, stepOrder: 1, type: "CALL_REMINDER", taskTitle: "Call about pricing" },
    });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await processDueSequenceStep(enrolled.enrollmentId, step1.id);

    const task = await testPrisma.task.findFirstOrThrow({ where: { companyId: company.id } });
    expect(task.title).toBe("Call about pricing");
    expect(task.assignedToId).toBe(user.id);

    const enrollment = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    expect(enrollment.status).toBe("COMPLETED");
    expect(enrollment.stoppedAt).not.toBeNull();

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { userId: user.id, type: "SEQUENCE_COMPLETED" } });
    expect((notification.payload as { enrollmentId: string }).enrollmentId).toBe(enrolled.enrollmentId);
  });

  it("stops the enrollment (STOPPED_OPT_OUT) instead of running the step when the contact has opted out", async () => {
    const { user, company } = await baseFixtures();
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" },
    });
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step1 = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "TASK", taskTitle: "Call" } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, contactId: contact.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await testPrisma.contact.update({ where: { id: contact.id }, data: { doNotContact: true } });
    await processDueSequenceStep(enrolled.enrollmentId, step1.id);

    const enrollment = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    expect(enrollment.status).toBe("STOPPED_OPT_OUT");
    expect(await testPrisma.task.count()).toBe(0);
    expect(await testPrisma.sequenceStepRun.count()).toBe(0);
  });

  it("stops the enrollment (STOPPED_STAGE) when the company reaches the sequence's stop stage", async () => {
    const { user, company, wonStage } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({
      data: { name: "Nurture", createdById: user.id, stopOnPipelineStageId: wonStage.id },
    });
    const step1 = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "TASK", taskTitle: "Call" } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await testPrisma.company.update({ where: { id: company.id }, data: { pipelineStageId: wonStage.id } });
    await processDueSequenceStep(enrolled.enrollmentId, step1.id);

    const enrollment = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    expect(enrollment.status).toBe("STOPPED_STAGE");
  });

  it("never runs the same step twice (duplicate-send prevention)", async () => {
    const { user, company } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step1 = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "TASK", taskTitle: "Call" } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await processDueSequenceStep(enrolled.enrollmentId, step1.id);
    await processDueSequenceStep(enrolled.enrollmentId, step1.id);

    expect(await testPrisma.task.count()).toBe(1);
    expect(await testPrisma.sequenceStepRun.count()).toBe(1);
  });

  it("is a no-op when the enrollment is PAUSED", async () => {
    const { user, company } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    const step1 = await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "TASK", taskTitle: "Call" } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await pauseEnrollment(enrolled.enrollmentId);
    await processDueSequenceStep(enrolled.enrollmentId, step1.id);

    expect(await testPrisma.task.count()).toBe(0);
  });
});

describe("pause / resume / cancel", () => {
  it("transitions correctly and rejects invalid transitions", async () => {
    const { user, company } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "TASK", taskTitle: "Call" } });
    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");

    await pauseEnrollment(enrolled.enrollmentId);
    expect((await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } })).status).toBe("PAUSED");

    await resumeEnrollment(enrolled.enrollmentId);
    expect((await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } })).status).toBe("ACTIVE");

    await cancelEnrollment(enrolled.enrollmentId);
    const cancelled = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    expect(cancelled.status).toBe("CANCELLED");

    // A cancelled enrollment can't be resumed.
    await resumeEnrollment(enrolled.enrollmentId);
    expect((await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } })).status).toBe("CANCELLED");
  });
});

describe("runSequenceTick", () => {
  it("enqueues only ACTIVE enrollments whose nextStepDueAt has passed", async () => {
    const { user, company } = await baseFixtures();
    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "TASK", taskTitle: "Call" } });

    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, enrolledById: user.id });
    if (!enrolled.ok) throw new Error("enroll failed");
    await testPrisma.sequenceEnrollment.update({ where: { id: enrolled.enrollmentId }, data: { nextStepDueAt: new Date(Date.now() - 1000) } });

    const enqueued = await runSequenceTick();
    expect(enqueued).toBe(1);
  });
});

describe("enrollCompanyInSequence (server action)", () => {
  it("enforces enroll_in_sequences and scopes to the company", async () => {
    const { company } = await baseFixtures();
    const noPermRole = await createRoleWithPermissions("NoEnroll", ["edit_leads"]);
    const outsider = await createTestUser({ roleId: noPermRole.id });
    await loginAs(outsider.id);

    const formData = new FormData();
    formData.set("sequenceId", "whatever");
    await expect(enrollCompanyInSequence(company.id, undefined, formData)).rejects.toThrow(/Forbidden/);
  });
});
