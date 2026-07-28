import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { sendEmail, scheduleEmail, processDueScheduledEmail } from "../../src/lib/comms/send-email";
import { sendComposedEmail, applySuggestedPipelineStage } from "../../src/app/(dashboard)/companies/[id]/email/actions";

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

async function baseFixtures() {
  const role = await createRoleWithPermissions("Sender", ["view_assigned_leads", "edit_leads", "send_email", "schedule_email"]);
  const user = await createTestUser({ roleId: role.id });
  await connectMailbox(user.id);
  const leadType = await createLeadTypeFixture();
  const fromStage = await createPipelineStageFixture("New", { isDefault: true });
  const toStage = await createPipelineStageFixture("Interested");
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: fromStage.id, assignedToId: user.id, createdById: user.id });
  const contact = await testPrisma.contact.create({
    data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
  });
  return { user, company, fromStage, toStage, contact };
}

async function templateFixture(userId: string, pipelineStageId: string | null) {
  return testPrisma.emailTemplate.create({
    data: {
      name: "Follow-up",
      subject: "Hi {{contact.firstName}}",
      body: UNSUBSCRIBE_BODY,
      visibility: "SHARED",
      pipelineStageId,
      createdById: userId,
    },
  });
}

describe("suggestedPipelineStageId snapshot on send", () => {
  it("snapshots the template's pipelineStageId onto the sent EmailMessage", async () => {
    const { user, company, toStage, contact } = await baseFixtures();
    await loginAs(user.id);
    const template = await templateFixture(user.id, toStage.id);

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, templateId: template.id, subject: template.subject, body: template.body });
    expect(result.ok).toBe(true);

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.suggestedPipelineStageId).toBe(toStage.id);
    expect(message.pipelineStageAppliedAt).toBeNull();
  });

  it("leaves suggestedPipelineStageId null when the template has no suggested stage", async () => {
    const { user, company, contact } = await baseFixtures();
    await loginAs(user.id);
    const template = await templateFixture(user.id, null);

    await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, templateId: template.id, subject: template.subject, body: template.body });

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.suggestedPipelineStageId).toBeNull();
  });

  it("leaves suggestedPipelineStageId null when no template was used at all", async () => {
    const { user, company, contact } = await baseFixtures();
    await loginAs(user.id);

    await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.suggestedPipelineStageId).toBeNull();
  });

  it("does not snapshot a suggested stage at schedule time -- only once the scheduled send actually goes out", async () => {
    const { user, company, toStage, contact } = await baseFixtures();
    await loginAs(user.id);
    const template = await templateFixture(user.id, toStage.id);

    const scheduled = await scheduleEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      templateId: template.id,
      subject: template.subject,
      body: template.body,
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });
    if (!scheduled.ok) throw new Error("expected schedule to succeed");

    const beforeSend = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(beforeSend.suggestedPipelineStageId).toBeNull();

    const outcome = await processDueScheduledEmail(scheduled.emailMessageId);
    expect(outcome.ok).toBe(true);

    const afterSend = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(afterSend.status).toBe("SENT");
    expect(afterSend.suggestedPipelineStageId).toBe(toStage.id);

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { userId: user.id, type: "SCHEDULED_EMAIL_STAGE_SUGGESTED" } });
    const payload = notification.payload as Record<string, unknown>;
    expect(payload.companyId).toBe(company.id);
    expect(payload.suggestedStageName).toBe("Interested");
  });
});

describe("applySuggestedPipelineStage", () => {
  it("moves the company to the suggested stage and marks who/when applied", async () => {
    const { user, company, toStage, contact } = await baseFixtures();
    await loginAs(user.id);
    const template = await templateFixture(user.id, toStage.id);
    await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, templateId: template.id, subject: template.subject, body: template.body });
    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });

    const result = await applySuggestedPipelineStage(company.id, message.id);
    expect(result?.error).toBeUndefined();

    const updatedCompany = await testPrisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updatedCompany.pipelineStageId).toBe(toStage.id);

    const updatedMessage = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(updatedMessage.pipelineStageAppliedAt).not.toBeNull();
    expect(updatedMessage.pipelineStageAppliedById).toBe(user.id);

    const history = await testPrisma.pipelineStageHistory.findFirstOrThrow({ where: { companyId: company.id, toStageId: toStage.id } });
    expect(history.changedById).toBe(user.id);
  });

  it("rejects applying the same suggestion twice", async () => {
    const { user, company, toStage, contact } = await baseFixtures();
    await loginAs(user.id);
    const template = await templateFixture(user.id, toStage.id);
    await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, templateId: template.id, subject: template.subject, body: template.body });
    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });

    await applySuggestedPipelineStage(company.id, message.id);
    const second = await applySuggestedPipelineStage(company.id, message.id);
    expect(second?.error).toMatch(/already been applied/);
  });

  it("errors when the email has no suggested stage", async () => {
    const { user, company, contact } = await baseFixtures();
    await loginAs(user.id);
    await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });

    const result = await applySuggestedPipelineStage(company.id, message.id);
    expect(result?.error).toMatch(/no suggested pipeline stage/);
  });

  it("blocks applying a suggestion for a company outside the caller's scope", async () => {
    const { company, toStage, contact, user } = await baseFixtures();
    const template = await templateFixture(user.id, toStage.id);
    await loginAs(user.id);
    await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, templateId: template.id, subject: template.subject, body: template.body });
    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });

    const outsiderRole = await createRoleWithPermissions("Outsider", ["view_assigned_leads", "edit_leads"]);
    const outsider = await createTestUser({ roleId: outsiderRole.id });
    await loginAs(outsider.id);

    await expect(applySuggestedPipelineStage(company.id, message.id)).rejects.toThrow(/forbidden/i);
  });
});

describe("sendComposedEmail integration", () => {
  it("snapshots the suggested stage end-to-end through the composer action", async () => {
    const { user, company, toStage, contact } = await baseFixtures();
    await loginAs(user.id);
    const template = await templateFixture(user.id, toStage.id);

    const fd = new FormData();
    fd.set("contactId", contact.id);
    fd.set("templateId", template.id);
    fd.set("subject", template.subject);
    fd.set("body", template.body);

    const result = await sendComposedEmail(company.id, undefined, fd);
    expect(result?.error).toBeUndefined();

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.suggestedPipelineStageId).toBe(toStage.id);
  });
});
