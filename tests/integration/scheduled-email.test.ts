import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { scheduleEmail, processDueScheduledEmail, cancelScheduledEmail } from "../../src/lib/comms/send-email";
import { runSendScheduledEmailTick } from "../../worker/handlers/send-scheduled-email-tick";
import { sendComposedEmail, cancelComposedScheduledEmail } from "../../src/app/(dashboard)/companies/[id]/email/actions";

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

async function baseFixtures(permissions: string[] = ["send_email", "schedule_email"]) {
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
      scopes: ["Mail.Send"],
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "CONNECTED",
    },
  });
}

async function permittedContactFixture(companyId: string, overrides: Partial<{ emailPermitted: boolean; doNotContact: boolean }> = {}) {
  return testPrisma.contact.create({
    data: {
      companyId,
      firstName: "Jamie",
      lastName: "Lead",
      email: "jamie@example.com",
      emailPermitted: overrides.emailPermitted ?? true,
      doNotContact: overrides.doNotContact ?? false,
    },
  });
}

describe("scheduleEmail / processDueScheduledEmail", () => {
  it("validates now but stores raw, unresolved subject/body with status SCHEDULED", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000);

    const result = await scheduleEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi {{contact.firstName}}",
      body: UNSUBSCRIBE_BODY,
      scheduledFor,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: result.emailMessageId } });
    expect(message.status).toBe("SCHEDULED");
    expect(message.subject).toBe("Hi {{contact.firstName}}");
    expect(message.scheduledFor?.getTime()).toBe(scheduledFor.getTime());
  });

  it("rejects scheduling when the contact lacks consent, before anything is stored", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id, { emailPermitted: false });

    const result = await scheduleEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi",
      body: UNSUBSCRIBE_BODY,
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(result.ok).toBe(false);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("sends a due scheduled email, resolving placeholders fresh at send time", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);

    const scheduled = await scheduleEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi {{contact.firstName}}",
      body: UNSUBSCRIBE_BODY,
      scheduledFor: new Date(Date.now() - 1000),
    });
    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) return;

    const outcome = await processDueScheduledEmail(scheduled.emailMessageId);
    expect(outcome.ok).toBe(true);

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(message.status).toBe("SENT");
    expect(message.subject).toBe("Hi Jamie");
  });

  it("fails a scheduled send whose contact withdrew consent in the meantime, with a SCHEDULED_EMAIL_FAILED notification", async () => {
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

    await testPrisma.contact.update({ where: { id: contact.id }, data: { doNotContact: true } });

    const outcome = await processDueScheduledEmail(scheduled.emailMessageId);
    expect(outcome.ok).toBe(false);

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(message.status).toBe("FAILED");

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { userId: user.id, type: "SCHEDULED_EMAIL_FAILED" } });
    expect((notification.payload as { emailMessageId: string }).emailMessageId).toBe(scheduled.emailMessageId);
  });

  it("is a no-op when the row is no longer SCHEDULED (already cancelled)", async () => {
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
    if (!scheduled.ok) return;

    await cancelScheduledEmail(scheduled.emailMessageId);
    const outcome = await processDueScheduledEmail(scheduled.emailMessageId);
    expect(outcome.ok).toBe(true);

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(message.status).toBe("CANCELLED");
  });
});

describe("runSendScheduledEmailTick", () => {
  it("enqueues only rows that are SCHEDULED and due", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    const baseData = { companyId: company.id, contactId: contact.id, toAddresses: [contact.email as string], body: UNSUBSCRIBE_BODY, createdById: user.id };

    await testPrisma.emailMessage.create({ data: { ...baseData, subject: "Due", status: "SCHEDULED", scheduledFor: new Date(Date.now() - 1000) } });
    await testPrisma.emailMessage.create({ data: { ...baseData, subject: "Not due yet", status: "SCHEDULED", scheduledFor: new Date(Date.now() + 60 * 60 * 1000) } });
    await testPrisma.emailMessage.create({ data: { ...baseData, subject: "Cancelled", status: "CANCELLED", scheduledFor: new Date(Date.now() - 1000) } });

    const enqueued = await runSendScheduledEmailTick();
    expect(enqueued).toBe(1);
  });
});

describe("composer scheduling action", () => {
  it("requires schedule_email to schedule (not just send_email)", async () => {
    const { user, company } = await baseFixtures(["send_email"]);
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("contactId", contact.id);
    formData.set("subject", "Hi");
    formData.set("body", UNSUBSCRIBE_BODY);
    formData.set("sendAt", new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));

    await expect(sendComposedEmail(company.id, undefined, formData)).rejects.toThrow(/Forbidden/);
  });

  it("rejects a past or invalid sendAt", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("contactId", contact.id);
    formData.set("subject", "Hi");
    formData.set("body", UNSUBSCRIBE_BODY);
    // 25 hours, not 1 — datetime-local strings are parsed as local time, and
    // an hour's difference could be masked or inverted by the test
    // environment's own timezone offset; 25 hours safely stays in the past
    // regardless of timezone.
    formData.set("sendAt", new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString().slice(0, 16));

    const result = await sendComposedEmail(company.id, undefined, formData);
    expect(result?.error).toMatch(/future date/);
  });

  it("lets the scheduling user cancel their own scheduled email, but not another user's", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    const scheduled = await scheduleEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi",
      body: UNSUBSCRIBE_BODY,
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });
    if (!scheduled.ok) return;

    const otherRole = await createRoleWithPermissions("OtherSender", ["schedule_email"]);
    const otherUser = await createTestUser({ roleId: otherRole.id });
    await loginAs(otherUser.id);
    const blocked = await cancelComposedScheduledEmail(company.id, scheduled.emailMessageId);
    expect(blocked?.error).toMatch(/yourself/);

    await loginAs(user.id);
    const result = await cancelComposedScheduledEmail(company.id, scheduled.emailMessageId);
    expect(result).toBeUndefined();

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(message.status).toBe("CANCELLED");
  });
});
