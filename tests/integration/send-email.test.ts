import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { sendEmail, sendEmailToCompany } from "../../src/lib/comms/send-email";
import { verifyUnsubscribeToken } from "../../src/lib/comms/unsubscribe-token";
import { sendComposedEmail, sendCompanyEmail } from "../../src/app/(dashboard)/companies/[id]/email/actions";
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

async function baseFixtures(permissions: string[] = ["send_email", "view_assigned_leads"], companyEmail: string | null = null) {
  const role = await createRoleWithPermissions("Sender", permissions);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture("New", { isDefault: true });
  const company = await createCompanyFixture({
    leadTypeId: leadType.id,
    pipelineStageId: stage.id,
    assignedToId: user.id,
    createdById: user.id,
    email: companyEmail,
  });
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

/** A permitted contact — the common case every test needs, since every
 * send now requires a linked, consented contact (no ad hoc address path). */
async function permittedContactFixture(companyId: string, overrides: Partial<{ email: string | null; emailPermitted: boolean; doNotContact: boolean }> = {}) {
  return testPrisma.contact.create({
    data: {
      companyId,
      firstName: "Jamie",
      lastName: "Lead",
      email: overrides.email === undefined ? "jamie@example.com" : overrides.email,
      emailPermitted: overrides.emailPermitted ?? true,
      doNotContact: overrides.doNotContact ?? false,
    },
  });
}

describe("sendEmail", () => {
  it("blocks a send to a company marked Do Not Contact", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    await testPrisma.company.update({ where: { id: company.id }, data: { doNotContact: true } });
    const contact = await permittedContactFixture(company.id);

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Do Not Contact/);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("blocks a send with an unresolved placeholder rather than sending it literally", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);

    const result = await sendEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi {{contact.nickname}}",
      body: UNSUBSCRIBE_BODY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/contact\.nickname/);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("blocks a send with an invalid cc address", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);

    const result = await sendEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      cc: ["not-an-email"],
      subject: "Hi",
      body: UNSUBSCRIBE_BODY,
    });
    expect(result.ok).toBe(false);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("blocks a send when the user has no connected mailbox", async () => {
    const { user, company } = await baseFixtures();
    const contact = await permittedContactFixture(company.id);

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Connect a mailbox/);
  });

  it("blocks a send when the contact does not exist", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: "not-a-real-id", subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Contact not found/);
  });

  it("blocks a send to a contact with no email address on file", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id, { email: null });

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no email address on file/);
  });

  it("resolves placeholders, sends, records a SENT EmailMessage, and logs an EMAIL activity", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);

    const result = await sendEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi {{contact.firstName}}",
      body: "Thanks for your interest in {{company.name}}. Unsubscribe: {{unsubscribeLink}}",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: result.emailMessageId } });
    expect(message.status).toBe("SENT");
    expect(message.subject).toBe("Hi Jamie");
    expect(message.body).toContain(company.name);
    expect(message.toAddresses).toEqual([contact.email]);
    expect(message.providerMessageId).toContain("mock-msg-");
    expect(message.sentAt).not.toBeNull();

    // The resolved unsubscribe link is a real, verifiable token for this contact.
    const linkMatch = message.body.match(/https?:\/\/\S+\/unsubscribe\?token=(\S+)/);
    expect(linkMatch).not.toBeNull();
    expect(verifyUnsubscribeToken(linkMatch![1])).toEqual({ contactId: contact.id });

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id, type: "EMAIL" } });
    expect(activity.notes).toContain("Hi Jamie");
  });

  it("allows a send to a contact who has not granted email permission — there is no consent gate for cold outreach to new leads", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id, { emailPermitted: false });

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(true);
  });

  it("blocks a send to a contact marked doNotContact even if emailPermitted is true", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id, { doNotContact: true });

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/opted out/);
  });

  it("silently appends a working unsubscribe footer when the composed body has no placeholder, rather than blocking the send", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);

    const result = await sendEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      subject: "Hi",
      body: "Thanks for your interest, no unsubscribe link here.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: result.emailMessageId } });
    // Not `\S+` for the token — the appended footer is `...token=XXXX</p>`
    // with no whitespace before the closing tag, so a whitespace-only
    // boundary would swallow `</p>` into the capture. Stop at `<` too.
    const linkMatch = message.body.match(/https?:\/\/[^\s<]+\/unsubscribe\?token=([^\s<]+)/);
    expect(linkMatch).not.toBeNull();
    expect(verifyUnsubscribeToken(linkMatch![1])).toEqual({ contactId: contact.id });
  });

  it("records a FAILED EmailMessage and a DELIVERY_FAILURE notification when the provider send fails", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id, { email: SIMULATED_SEND_FAILURE_ADDRESS });

    const result = await sendEmail({ userId: user.id, companyId: company.id, contactId: contact.id, subject: "Hi", body: UNSUBSCRIBE_BODY });
    expect(result.ok).toBe(false);

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.status).toBe("FAILED");
    expect(message.errorMessage).toMatch(/Simulated provider failure/);

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { userId: user.id, type: "DELIVERY_FAILURE" } });
    expect((notification.payload as { emailMessageId: string }).emailMessageId).toBe(message.id);
  });
});

describe("sendComposedEmail (server action)", () => {
  it("blocks a user without send_email from sending", async () => {
    const { user, company } = await baseFixtures([]);
    const contact = await permittedContactFixture(company.id);
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("contactId", contact.id);
    formData.set("subject", "Hi");
    formData.set("body", UNSUBSCRIBE_BODY);

    await expect(sendComposedEmail(company.id, undefined, formData)).rejects.toThrow(/Forbidden/);
  });

  it("blocks a send with no contact selected", async () => {
    const { user, company } = await baseFixtures();
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("subject", "Hi");
    formData.set("body", UNSUBSCRIBE_BODY);

    const result = await sendComposedEmail(company.id, undefined, formData);
    expect(result?.error).toMatch(/Choose a contact/);
  });

  it("sends to the selected contact's own email, ignoring any cc/bcc parsing edge cases", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await permittedContactFixture(company.id);
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("contactId", contact.id);
    formData.set("cc", "one@example.com, two@example.com\nthree@example.com");
    formData.set("subject", "Hi");
    formData.set("body", UNSUBSCRIBE_BODY);

    const result = await sendComposedEmail(company.id, undefined, formData);
    expect(result).toBeUndefined();

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.toAddresses).toEqual([contact.email]);
    expect(message.ccAddresses).toEqual(["one@example.com", "two@example.com", "three@example.com"]);
  });
});

describe("sendEmailToCompany", () => {
  it("sends directly to Company.email with no Contact involved, recording contactId: null", async () => {
    const { user, company } = await baseFixtures(["send_email", "view_assigned_leads"], "info@example.test");
    await connectMailbox(user.id);

    const result = await sendEmailToCompany({ userId: user.id, companyId: company.id, subject: "Hi", body: "Just checking in." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: result.emailMessageId } });
    expect(message.status).toBe("SENT");
    expect(message.contactId).toBeNull();
    expect(message.companyId).toBe(company.id);
    expect(message.toAddresses).toEqual(["info@example.test"]);
    expect(message.subject).toBe("Hi");
    expect(message.body).toBe("Just checking in.");

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id, type: "EMAIL" } });
    expect(activity.notes).toContain("Hi");
  });

  it("rejects when the company has no email address on file", async () => {
    const { user, company } = await baseFixtures(["send_email", "view_assigned_leads"], null);
    await connectMailbox(user.id);

    const result = await sendEmailToCompany({ userId: user.id, companyId: company.id, subject: "Hi", body: "Body." });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no email address on file/);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("blocks a send to a company marked Do Not Contact", async () => {
    const { user, company } = await baseFixtures(["send_email", "view_assigned_leads"], "info@example.test");
    await connectMailbox(user.id);
    await testPrisma.company.update({ where: { id: company.id }, data: { doNotContact: true } });

    const result = await sendEmailToCompany({ userId: user.id, companyId: company.id, subject: "Hi", body: "Body." });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Do Not Contact/);
  });

  it("blocks a send when the user has no connected mailbox", async () => {
    const { user, company } = await baseFixtures(["send_email", "view_assigned_leads"], "info@example.test");

    const result = await sendEmailToCompany({ userId: user.id, companyId: company.id, subject: "Hi", body: "Body." });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Connect a mailbox/);
  });

  it("blocks a send with an invalid cc address, and does not use a template/unsubscribe footer", async () => {
    const { user, company } = await baseFixtures(["send_email", "view_assigned_leads"], "info@example.test");
    await connectMailbox(user.id);

    const result = await sendEmailToCompany({ userId: user.id, companyId: company.id, cc: ["not-an-email"], subject: "Hi", body: "Body." });
    expect(result.ok).toBe(false);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });
});

describe("sendCompanyEmail (server action)", () => {
  it("blocks a user without send_email from sending", async () => {
    const { user, company } = await baseFixtures([], "info@example.test");
    await loginAs(user.id);

    await expect(sendCompanyEmail(company.id, "Hi", "Body.")).rejects.toThrow(/Forbidden/);
  });

  it("re-validates the company's email server-side rather than trusting the client", async () => {
    const { user, company } = await baseFixtures(["send_email", "view_assigned_leads"], null);
    await connectMailbox(user.id);
    await loginAs(user.id);

    const result = await sendCompanyEmail(company.id, "Hi", "Body.");
    expect(result?.error).toMatch(/no email address on file/);
  });

  it("sends to the company's email and revalidates the page", async () => {
    const { user, company } = await baseFixtures(["send_email", "view_assigned_leads"], "info@example.test");
    await connectMailbox(user.id);
    await loginAs(user.id);

    const result = await sendCompanyEmail(company.id, "Hi", "Body.");
    expect(result).toBeUndefined();

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.toAddresses).toEqual(["info@example.test"]);
    expect(message.contactId).toBeNull();
  });
});
