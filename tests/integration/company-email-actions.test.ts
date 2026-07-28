import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { sendComposedEmail, cancelComposedScheduledEmail } from "../../src/app/(dashboard)/companies/[id]/email/actions";
import { scheduleEmail } from "../../src/lib/comms/send-email";

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

function emailFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const defaults: Record<string, string> = { subject: "Hi", body: UNSUBSCRIBE_BODY };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) fd.set(key, value);
  return fd;
}

// Module Ten regression: sendComposedEmail/cancelComposedScheduledEmail
// previously checked only the role-level send_email/schedule_email
// permission, never that companyId was a company the caller was actually
// scoped to see — a Salesperson could send/schedule email against any
// company by ID, outside their assignment/team.
describe("company email actions — scope enforcement", () => {
  it("blocks sending against a company outside the caller's scope", async () => {
    const scopedRole = await createRoleWithPermissions("ScopedSender", ["view_assigned_leads", "send_email"]);
    const outsider = await createTestUser({ name: "Outsider", roleId: scopedRole.id });
    await connectMailbox(outsider.id);

    const ownerRole = await createRoleWithPermissions("Owner", ["view_assigned_leads", "add_leads"]);
    const owner = await createTestUser({ name: "Owner", roleId: ownerRole.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: owner.id, createdById: owner.id });
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
    });

    await loginAs(outsider.id);
    await expect(sendComposedEmail(company.id, undefined, emailFormData({ contactId: contact.id }))).rejects.toThrow(/forbidden/i);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("allows sending against a company within the caller's scope", async () => {
    const role = await createRoleWithPermissions("Sender", ["view_assigned_leads", "send_email"]);
    const user = await createTestUser({ roleId: role.id });
    await connectMailbox(user.id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
    });

    await loginAs(user.id);
    const result = await sendComposedEmail(company.id, undefined, emailFormData({ contactId: contact.id }));
    expect(result?.error).toBeUndefined();
    expect(await testPrisma.emailMessage.count()).toBe(1);
  });

  it("blocks scheduling against a company outside the caller's scope", async () => {
    const scopedRole = await createRoleWithPermissions("ScopedScheduler", ["view_assigned_leads", "send_email", "schedule_email"]);
    const outsider = await createTestUser({ name: "Outsider", roleId: scopedRole.id });
    await connectMailbox(outsider.id);

    const ownerRole = await createRoleWithPermissions("Owner2", ["view_assigned_leads", "add_leads"]);
    const owner = await createTestUser({ name: "Owner2", roleId: ownerRole.id });
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: owner.id, createdById: owner.id });
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
    });

    await loginAs(outsider.id);
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await expect(sendComposedEmail(company.id, undefined, emailFormData({ contactId: contact.id, sendAt: futureIso }))).rejects.toThrow(/forbidden/i);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("blocks cancelling a scheduled email once the caller's own scope no longer covers the company (e.g. reassigned away)", async () => {
    const schedulerRole = await createRoleWithPermissions("Scheduler3", ["view_assigned_leads", "add_leads", "schedule_email"]);
    const scheduler = await createTestUser({ name: "Scheduler3", roleId: schedulerRole.id });
    await connectMailbox(scheduler.id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: scheduler.id, createdById: scheduler.id });
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
    });
    const scheduled = await scheduleEmail({
      userId: scheduler.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi",
      body: UNSUBSCRIBE_BODY,
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });
    if (!scheduled.ok) throw new Error("expected schedule to succeed");

    // The company is reassigned away from the scheduler after scheduling —
    // the old code's createdById-only ownership check would still let them
    // cancel (they scheduled it); the new companyScope check correctly
    // blocks it once they're no longer scoped to see this company at all.
    const otherRole = await createRoleWithPermissions("Other3", ["view_assigned_leads"]);
    const other = await createTestUser({ roleId: otherRole.id });
    await testPrisma.company.update({ where: { id: company.id }, data: { assignedToId: other.id } });

    await loginAs(scheduler.id);
    await expect(cancelComposedScheduledEmail(company.id, scheduled.emailMessageId)).rejects.toThrow(/forbidden/i);
    const stillScheduled = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: scheduled.emailMessageId } });
    expect(stillScheduled.status).toBe("SCHEDULED");
  });
});

describe("company email actions — link attachments", () => {
  async function baseFixtures() {
    const role = await createRoleWithPermissions("Sender", ["view_assigned_leads", "send_email"]);
    const user = await createTestUser({ roleId: role.id });
    await connectMailbox(user.id);
    const leadType = await createLeadTypeFixture();
    const stage = await createPipelineStageFixture("New", { isDefault: true });
    const company = await createCompanyFixture({ leadTypeId: leadType.id, pipelineStageId: stage.id, assignedToId: user.id, createdById: user.id });
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com", emailPermitted: true },
    });
    return { user, company, contact };
  }

  it("stores valid links as a snapshot on the sent EmailMessage", async () => {
    const { user, company, contact } = await baseFixtures();
    await loginAs(user.id);

    const links = [{ label: "Menu", url: "https://drive.google.com/menu" }, { label: "Photos", url: "https://example.com/photos" }];
    const result = await sendComposedEmail(company.id, undefined, emailFormData({ contactId: contact.id, links: JSON.stringify(links) }));
    expect(result?.error).toBeUndefined();

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.links).toEqual(links);
  });

  it("drops a link with a non-http(s) URL rather than storing it or failing the send", async () => {
    const { user, company, contact } = await baseFixtures();
    await loginAs(user.id);

    const links = [{ label: "Bad", url: "javascript:alert(1)" }, { label: "Good", url: "https://example.com/ok" }];
    const result = await sendComposedEmail(company.id, undefined, emailFormData({ contactId: contact.id, links: JSON.stringify(links) }));
    expect(result?.error).toBeUndefined();

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.links).toEqual([{ label: "Good", url: "https://example.com/ok" }]);
  });

  it("leaves links null when none were provided", async () => {
    const { user, company, contact } = await baseFixtures();
    await loginAs(user.id);

    const result = await sendComposedEmail(company.id, undefined, emailFormData({ contactId: contact.id }));
    expect(result?.error).toBeUndefined();

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.links).toBeNull();
  });
});
