import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { sendEmail } from "../../src/lib/comms/send-email";
import { sendComposedEmail } from "../../src/app/(dashboard)/companies/[id]/email/actions";
import { SIMULATED_SEND_FAILURE_ADDRESS } from "../../src/lib/comms/providers/mock";

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

async function baseFixtures(permissions: string[] = ["send_email"]) {
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

describe("sendEmail", () => {
  it("blocks a send to a company marked Do Not Contact", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    await testPrisma.company.update({ where: { id: company.id }, data: { doNotContact: true } });

    const result = await sendEmail({ userId: user.id, companyId: company.id, to: ["lead@example.com"], subject: "Hi", body: "Hello" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Do Not Contact/);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("blocks a send with an unresolved placeholder rather than sending it literally", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);

    const result = await sendEmail({
      userId: user.id,
      companyId: company.id,
      to: ["lead@example.com"],
      subject: "Hi {{contact.firstName}}",
      body: "Body text",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/contact\.firstName/);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("blocks a send with an invalid recipient address", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);

    const result = await sendEmail({ userId: user.id, companyId: company.id, to: ["not-an-email"], subject: "Hi", body: "Hello" });
    expect(result.ok).toBe(false);
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });

  it("blocks a send when the user has no connected mailbox", async () => {
    const { user, company } = await baseFixtures();

    const result = await sendEmail({ userId: user.id, companyId: company.id, to: ["lead@example.com"], subject: "Hi", body: "Hello" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Connect a mailbox/);
  });

  it("resolves placeholders, sends, records a SENT EmailMessage, and logs an EMAIL activity", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    const contact = await testPrisma.contact.create({
      data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" },
    });

    const result = await sendEmail({
      userId: user.id,
      companyId: company.id,
      contactId: contact.id,
      to: ["jamie@example.com"],
      subject: "Hi {{contact.firstName}}",
      body: "Thanks for your interest in {{company.name}}.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const message = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: result.emailMessageId } });
    expect(message.status).toBe("SENT");
    expect(message.subject).toBe("Hi Jamie");
    expect(message.body).toContain(company.name);
    expect(message.providerMessageId).toContain("mock-msg-");
    expect(message.sentAt).not.toBeNull();

    const activity = await testPrisma.activity.findFirstOrThrow({ where: { companyId: company.id, type: "EMAIL" } });
    expect(activity.notes).toContain("Hi Jamie");
  });

  it("records a FAILED EmailMessage and a DELIVERY_FAILURE notification when the provider send fails", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);

    const result = await sendEmail({
      userId: user.id,
      companyId: company.id,
      to: [SIMULATED_SEND_FAILURE_ADDRESS],
      subject: "Hi",
      body: "Hello",
    });
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
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("to", "lead@example.com");
    formData.set("subject", "Hi");
    formData.set("body", "Hello");

    await expect(sendComposedEmail(company.id, undefined, formData)).rejects.toThrow(/Forbidden/);
  });

  it("parses comma and newline separated recipients and sends successfully", async () => {
    const { user, company } = await baseFixtures();
    await connectMailbox(user.id);
    await loginAs(user.id);

    const formData = new FormData();
    formData.set("to", "one@example.com, two@example.com\nthree@example.com");
    formData.set("subject", "Hi");
    formData.set("body", "Hello");

    const result = await sendComposedEmail(company.id, undefined, formData);
    expect(result).toBeUndefined();

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { companyId: company.id } });
    expect(message.toAddresses).toEqual(["one@example.com", "two@example.com", "three@example.com"]);
  });
});
