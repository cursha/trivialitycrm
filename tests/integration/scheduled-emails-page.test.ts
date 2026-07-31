import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { scheduleEmail } from "../../src/lib/comms/send-email";
import { updateScheduledEmail, cancelScheduledEmailAction } from "../../src/app/(dashboard)/settings/scheduled-emails/actions";

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

async function scheduledEmailFixture(permissions: string[] = ["view_assigned_leads", "send_email", "schedule_email"]) {
  const role = await createRoleWithPermissions("Scheduler", permissions);
  const user = await createTestUser({ roleId: role.id });
  await connectMailbox(user.id);
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
  const contact = await testPrisma.contact.create({
    data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
  });
  await loginAs(user.id);
  const scheduled = await scheduleEmail({
    userId: user.id,
    companyId: company.id,
    contactId: contact.id,
    subject: "Original subject",
    body: UNSUBSCRIBE_BODY,
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
  });
  if (!scheduled.ok) throw new Error("expected schedule to succeed");
  return { user, company, contact, emailMessageId: scheduled.emailMessageId };
}

function editFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = {
    subject: "Updated subject",
    body: UNSUBSCRIBE_BODY,
    cc: "",
    bcc: "",
    sendAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) fd.set(key, value);
  return fd;
}

describe("updateScheduledEmail", () => {
  it("updates subject/body/cc/bcc/scheduledFor on a still-scheduled email", async () => {
    const { emailMessageId } = await scheduledEmailFixture();
    const newSendAt = new Date(Date.now() + 3 * 60 * 60 * 1000);

    const result = await updateScheduledEmail(
      emailMessageId,
      undefined,
      editFormData({ subject: "New subject", cc: "cc@example.com", sendAt: newSendAt.toISOString() }),
    );
    expect(result?.error).toBeUndefined();

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
    expect(message.subject).toBe("New subject");
    expect(message.ccAddresses).toEqual(["cc@example.com"]);
    expect(message.status).toBe("SCHEDULED");
  });

  it("rejects a past send time", async () => {
    const { emailMessageId } = await scheduledEmailFixture();
    const result = await updateScheduledEmail(emailMessageId, undefined, editFormData({ sendAt: new Date(Date.now() - 60_000).toISOString() }));
    expect(result?.error).toMatch(/future/);
  });

  it("allows saving a body with no unsubscribe placeholder — the actual send appends one, this edit form no longer blocks on it", async () => {
    const { emailMessageId } = await scheduledEmailFixture();
    const result = await updateScheduledEmail(emailMessageId, undefined, editFormData({ body: "No unsubscribe link here." }));
    expect(result?.error).toBeUndefined();
    const updated = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
    expect(updated.body).toBe("No unsubscribe link here.");
  });

  it("blocks a different user without view_team_communications from editing someone else's scheduled email", async () => {
    const { emailMessageId } = await scheduledEmailFixture();

    const otherRole = await createRoleWithPermissions("Other", ["view_assigned_leads", "schedule_email"]);
    const other = await createTestUser({ roleId: otherRole.id });
    await loginAs(other.id);

    const result = await updateScheduledEmail(emailMessageId, undefined, editFormData());
    expect(result?.error).toMatch(/yourself/i);
  });

  it("allows a user with view_team_communications to edit a teammate's scheduled email", async () => {
    const { emailMessageId } = await scheduledEmailFixture();

    const managerRole = await createRoleWithPermissions("Manager", ["view_assigned_leads", "schedule_email", "view_team_communications"]);
    const manager = await createTestUser({ roleId: managerRole.id });
    await loginAs(manager.id);

    const result = await updateScheduledEmail(emailMessageId, undefined, editFormData({ subject: "Manager edit" }));
    expect(result?.error).toBeUndefined();
    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
    expect(message.subject).toBe("Manager edit");
  });

  it("refuses to edit once the row is no longer SCHEDULED (e.g. a worker already sent it)", async () => {
    const { emailMessageId } = await scheduledEmailFixture();
    await testPrisma.emailMessage.update({ where: { id: emailMessageId }, data: { status: "SENT" } });

    const result = await updateScheduledEmail(emailMessageId, undefined, editFormData());
    expect(result?.error).toMatch(/not found/i);
    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
    expect(message.subject).toBe("Original subject");
  });
});

describe("cancelScheduledEmailAction", () => {
  it("cancels a scheduled email the caller owns", async () => {
    const { emailMessageId } = await scheduledEmailFixture();
    const result = await cancelScheduledEmailAction(emailMessageId);
    expect(result?.error).toBeUndefined();
    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
    expect(message.status).toBe("CANCELLED");
  });

  it("blocks cancelling someone else's scheduled email without view_team_communications", async () => {
    const { emailMessageId } = await scheduledEmailFixture();
    const otherRole = await createRoleWithPermissions("Other2", ["view_assigned_leads", "schedule_email"]);
    const other = await createTestUser({ roleId: otherRole.id });
    await loginAs(other.id);

    const result = await cancelScheduledEmailAction(emailMessageId);
    expect(result?.error).toMatch(/yourself/i);
    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
    expect(message.status).toBe("SCHEDULED");
  });
});
