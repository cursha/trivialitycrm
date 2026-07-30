import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, createLeadTypeFixture, createPipelineStageFixture, createCompanyFixture } from "../helpers/fixtures";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { matchContactForAddress, processInboundNotification } from "../../src/lib/comms/inbound-sync";
import { enrollInSequence } from "../../src/lib/comms/sequences";
import { buildMockWebhookBody, SIMULATED_INBOUND_FETCH_FAILURE_ADDRESS } from "../../src/lib/comms/providers/mock";
import { MockEmailProvider } from "../../src/lib/comms/providers/mock";

const TEST_KEY = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(async () => {
  await resetDatabase();
  mutableEnv.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  resetEnvCacheForTests();
});

async function baseFixtures() {
  const role = await createRoleWithPermissions(`Sender-${crypto.randomUUID()}`, []);
  const user = await createTestUser({ roleId: role.id });
  const leadType = await createLeadTypeFixture();
  const stage = await createPipelineStageFixture(`New-${crypto.randomUUID()}`, { isDefault: true });
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
      scopes: ["Mail.Read"],
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "CONNECTED",
    },
  });
}

/** Encodes a fixture the same way MockEmailProvider does internally, so
 * processInboundNotification (which calls fetchInboundMessage under the
 * hood) can be driven directly without going through the webhook route. */
function mockProviderMessageId(fixture: { fromAddress: string; subject: string; bodyHtml: string; providerThreadId?: string }): string {
  const provider = new MockEmailProvider();
  const [notification] = provider.parseInboundWebhookPayload(
    buildMockWebhookBody([{ subscriptionId: "sub-1", clientState: "secret", ...fixture }]),
  );
  return notification.providerMessageId;
}

describe("matchContactForAddress", () => {
  it("returns null for an address matching no contact", async () => {
    expect(await matchContactForAddress("nobody@example.com")).toBeNull();
  });

  it("returns the contact for a single case-insensitive match", async () => {
    const { company } = await baseFixtures();
    const contact = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "Jamie@Example.com" } });

    const match = await matchContactForAddress("jamie@example.com");
    expect(match).toEqual({ contactId: contact.id, companyId: company.id });
  });

  it("returns null when the address matches more than one contact (ambiguous)", async () => {
    const { company } = await baseFixtures();
    const { company: companyB } = await baseFixtures();
    await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "A", email: "shared@example.com" } });
    await testPrisma.contact.create({ data: { companyId: companyB.id, firstName: "Jamie", lastName: "B", email: "shared@example.com" } });

    expect(await matchContactForAddress("shared@example.com")).toBeNull();
  });
});

describe("processInboundNotification", () => {
  it("creates an unmatched EmailMessage (null company/contact) for an unknown sender", async () => {
    const { user } = await baseFixtures();
    const connection = await connectMailbox(user.id);
    const providerMessageId = mockProviderMessageId({ fromAddress: "stranger@example.com", subject: "Hi", bodyHtml: "<p>Hi</p>" });

    await processInboundNotification({ connectionId: connection.id, providerMessageId });

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { providerMessageId } });
    expect(message.direction).toBe("INBOUND");
    expect(message.companyId).toBeNull();
    expect(message.contactId).toBeNull();
    expect(message.reviewedAt).toBeNull();
    expect(message.status).toBe("RECEIVED");
  });

  it("matches a known contact and stops an active sequence enrollment with STOPPED_REPLY + a NEW_REPLY notification", async () => {
    const { user, company } = await baseFixtures();
    const connection = await connectMailbox(user.id);
    const contact = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" } });

    const sequence = await testPrisma.followUpSequence.create({ data: { name: "Nurture", createdById: user.id } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 1, type: "WAIT", waitDays: 3 } });
    await testPrisma.sequenceStep.create({ data: { sequenceId: sequence.id, stepOrder: 2, type: "TASK", taskTitle: "Call" } });
    const enrolled = await enrollInSequence({ sequenceId: sequence.id, companyId: company.id, contactId: contact.id, enrolledById: user.id });
    expect(enrolled.ok).toBe(true);

    const providerMessageId = mockProviderMessageId({ fromAddress: "jamie@example.com", subject: "Re: Demo", bodyHtml: "<p>Sounds great</p>" });
    await processInboundNotification({ connectionId: connection.id, providerMessageId });

    const message = await testPrisma.emailMessage.findFirstOrThrow({ where: { providerMessageId } });
    expect(message.contactId).toBe(contact.id);
    expect(message.companyId).toBe(company.id);

    if (!enrolled.ok) throw new Error("unreachable");
    const enrollment = await testPrisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrolled.enrollmentId } });
    expect(enrollment.status).toBe("STOPPED_REPLY");

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { type: "NEW_REPLY" } });
    expect(notification.userId).toBe(user.id);
  });

  it("matches a known contact and stops an ACTIVE campaign recipient with STOPPED_REPLY", async () => {
    const { user, company } = await baseFixtures();
    const connection = await connectMailbox(user.id);
    const contact = await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" } });

    const list = await testPrisma.salesList.create({ data: { name: "Campaign List", purpose: "EMAIL_CAMPAIGN", type: "FIXED", ownerId: user.id } });
    const campaign = await testPrisma.campaign.create({ data: { name: "Nurture Campaign", listId: list.id, createdById: user.id, senderId: user.id } });
    const step = await testPrisma.campaignStep.create({ data: { campaignId: campaign.id, stepOrder: 1, waitDays: 0 } });
    const recipient = await testPrisma.campaignRecipient.create({
      data: { campaignId: campaign.id, companyId: company.id, contactId: contact.id, status: "ACTIVE", currentStepId: step.id },
    });

    const providerMessageId = mockProviderMessageId({ fromAddress: "jamie@example.com", subject: "Re: Offer", bodyHtml: "<p>Interested</p>" });
    await processInboundNotification({ connectionId: connection.id, providerMessageId });

    const stopped = await testPrisma.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
    expect(stopped.status).toBe("STOPPED_REPLY");
    expect(stopped.nextStepDueAt).toBeNull();
  });

  it("sends a general NEW_REPLY notification to the assigned salesperson when a matched contact has no active enrollment to stop", async () => {
    const { user, company } = await baseFixtures();
    const connection = await connectMailbox(user.id);
    await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" } });

    const providerMessageId = mockProviderMessageId({ fromAddress: "jamie@example.com", subject: "Hi", bodyHtml: "<p>Hi</p>" });
    await processInboundNotification({ connectionId: connection.id, providerMessageId });

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { type: "NEW_REPLY" } });
    expect(notification.userId).toBe(user.id);
  });

  it("is idempotent for the same providerMessageId — a retried job never creates a second EmailMessage row", async () => {
    const { user } = await baseFixtures();
    const connection = await connectMailbox(user.id);
    const providerMessageId = mockProviderMessageId({ fromAddress: "stranger@example.com", subject: "Hi", bodyHtml: "<p>Hi</p>" });

    await processInboundNotification({ connectionId: connection.id, providerMessageId });
    await processInboundNotification({ connectionId: connection.id, providerMessageId });

    expect(await testPrisma.emailMessage.count({ where: { providerMessageId } })).toBe(1);
  });

  it("propagates a fetch failure without writing any EmailMessage row", async () => {
    const { user } = await baseFixtures();
    const connection = await connectMailbox(user.id);
    const providerMessageId = mockProviderMessageId({
      fromAddress: SIMULATED_INBOUND_FETCH_FAILURE_ADDRESS,
      subject: "Hi",
      bodyHtml: "Hi",
    });

    await expect(processInboundNotification({ connectionId: connection.id, providerMessageId })).rejects.toThrow(
      /Simulated inbound fetch failure/,
    );
    expect(await testPrisma.emailMessage.count()).toBe(0);
  });
});

describe("processInboundNotification — bounce detection", () => {
  it("flips the matching sent message to BOUNCED and notifies its sender, creating no inbound EmailMessage row", async () => {
    const { user, company } = await baseFixtures();
    const connection = await connectMailbox(user.id);
    const sent = await testPrisma.emailMessage.create({
      data: {
        companyId: company.id,
        direction: "OUTBOUND",
        providerConnectionId: connection.id,
        toAddresses: ["lead@example.com"],
        subject: "Following up",
        body: "Hi there",
        status: "SENT",
        providerThreadId: "thread-123",
        createdById: user.id,
      },
    });

    const providerMessageId = mockProviderMessageId({
      fromAddress: "postmaster@example.com",
      subject: "Undeliverable: Following up",
      bodyHtml: "The following message could not be delivered.",
      providerThreadId: "thread-123",
    });
    await processInboundNotification({ connectionId: connection.id, providerMessageId });

    const updated = await testPrisma.emailMessage.findUniqueOrThrow({ where: { id: sent.id } });
    expect(updated.status).toBe("BOUNCED");
    expect(updated.errorMessage).toBeTruthy();

    expect(await testPrisma.emailMessage.count({ where: { direction: "INBOUND" } })).toBe(0);

    const notification = await testPrisma.notification.findFirstOrThrow({ where: { type: "EMAIL_BOUNCED" } });
    expect(notification.userId).toBe(user.id);
    expect((notification.payload as Record<string, unknown>).emailMessageId).toBe(sent.id);
  });

  it("logs and does nothing when a recognized bounce matches no sent message", async () => {
    const { user } = await baseFixtures();
    const connection = await connectMailbox(user.id);

    const providerMessageId = mockProviderMessageId({
      fromAddress: "mailer-daemon@example.com",
      subject: "Mail delivery failed",
      bodyHtml: "no match",
      providerThreadId: "thread-no-such-sent-message",
    });
    await processInboundNotification({ connectionId: connection.id, providerMessageId });

    expect(await testPrisma.emailMessage.count()).toBe(0);
    expect(await testPrisma.notification.count({ where: { type: "EMAIL_BOUNCED" } })).toBe(0);
  });

  it("does not treat an ordinary reply as a bounce", async () => {
    const { user, company } = await baseFixtures();
    const connection = await connectMailbox(user.id);
    await testPrisma.contact.create({ data: { companyId: company.id, firstName: "Jamie", lastName: "Lead", email: "jamie@example.com" } });

    const providerMessageId = mockProviderMessageId({ fromAddress: "jamie@example.com", subject: "Re: Following up", bodyHtml: "Sounds good" });
    await processInboundNotification({ connectionId: connection.id, providerMessageId });

    expect(await testPrisma.emailMessage.count({ where: { direction: "INBOUND" } })).toBe(1);
    expect(await testPrisma.notification.count({ where: { type: "EMAIL_BOUNCED" } })).toBe(0);
  });
});
