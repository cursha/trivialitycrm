import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { Webhook } from "svix";
import { resetDatabase, testPrisma } from "../helpers/db";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { POST as webhookRoute } from "../../src/app/api/transactional-email/webhooks/resend/route";

const WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  delete mutableEnv.EMAIL_PROVIDER;
  delete mutableEnv.RESEND_API_KEY;
  delete mutableEnv.RESEND_FROM_ADDRESS;
  delete mutableEnv.RESEND_WEBHOOK_SECRET;
  resetEnvCacheForTests();
});

function configureResend() {
  mutableEnv.EMAIL_PROVIDER = "resend";
  mutableEnv.RESEND_API_KEY = "re_test_key";
  mutableEnv.RESEND_FROM_ADDRESS = "noreply@example.test";
  mutableEnv.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  resetEnvCacheForTests();
}

function signedRequest(payload: object, overrides: { id?: string; timestamp?: Date } = {}) {
  const id = overrides.id ?? `msg_${crypto.randomUUID()}`;
  const timestamp = overrides.timestamp ?? new Date();
  const body = JSON.stringify(payload);
  const signature = new Webhook(WEBHOOK_SECRET).sign(id, timestamp, body);

  return new Request("http://localhost/api/transactional-email/webhooks/resend", {
    method: "POST",
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signature,
    },
  });
}

async function fixtureMessage(overrides: { providerMessageId?: string; toAddress?: string } = {}) {
  return testPrisma.transactionalEmailMessage.create({
    data: {
      purpose: "ADMIN_TEST",
      toAddress: overrides.toAddress ?? "recipient@example.test",
      subject: "Test",
      body: "Hello",
      status: "SENT",
      idempotencyKey: `key-${crypto.randomUUID()}`,
      providerMessageId: overrides.providerMessageId ?? `resend-${crypto.randomUUID()}`,
      sentAt: new Date(),
    },
  });
}

function deliveredEvent(emailId: string) {
  return { type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: emailId, created_at: new Date().toISOString(), from: "noreply@example.test", to: ["recipient@example.test"], subject: "Test" } };
}

function bouncedEvent(emailId: string, bounceType: string) {
  return {
    type: "email.bounced",
    created_at: new Date().toISOString(),
    data: {
      email_id: emailId,
      created_at: new Date().toISOString(),
      from: "noreply@example.test",
      to: ["recipient@example.test"],
      subject: "Test",
      bounce: { type: bounceType, subType: "General", message: "Mailbox does not exist" },
    },
  };
}

function complainedEvent(emailId: string) {
  return { type: "email.complained", created_at: new Date().toISOString(), data: { email_id: emailId, created_at: new Date().toISOString(), from: "noreply@example.test", to: ["recipient@example.test"], subject: "Test" } };
}

describe("POST /api/transactional-email/webhooks/resend", () => {
  it("404s when the provider/secret isn't configured", async () => {
    const response = await webhookRoute(new Request("http://localhost/api/transactional-email/webhooks/resend", { method: "POST", body: "{}" }));
    expect(response.status).toBe(404);
  });

  it("rejects an invalid signature with 401 and processes nothing", async () => {
    configureResend();
    const message = await fixtureMessage();
    const response = await webhookRoute(
      new Request("http://localhost/api/transactional-email/webhooks/resend", {
        method: "POST",
        body: JSON.stringify(deliveredEvent(message.providerMessageId!)),
        headers: { "svix-id": "msg_bad", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,not-a-real-signature" },
      }),
    );
    expect(response.status).toBe(401);
    const unchanged = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(unchanged.status).toBe("SENT");
  });

  it("rejects a request with missing signature headers", async () => {
    configureResend();
    const response = await webhookRoute(
      new Request("http://localhost/api/transactional-email/webhooks/resend", { method: "POST", body: JSON.stringify({ type: "email.delivered" }) }),
    );
    expect(response.status).toBe(401);
  });

  it("accepts a validly signed delivered event and updates the message status", async () => {
    configureResend();
    const message = await fixtureMessage();

    const response = await webhookRoute(signedRequest(deliveredEvent(message.providerMessageId!)));
    expect(response.status).toBe(202);

    const updated = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe("DELIVERED");
  });

  it("is idempotent — replaying the exact same svix-id does not reprocess", async () => {
    configureResend();
    const message = await fixtureMessage();
    const request = deliveredEvent(message.providerMessageId!);
    const id = `msg_${crypto.randomUUID()}`;
    const timestamp = new Date();

    const first = await webhookRoute(signedRequest(request, { id, timestamp }));
    const second = await webhookRoute(signedRequest(request, { id, timestamp }));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await testPrisma.emailDeliveryEvent.count({ where: { providerEventId: id } })).toBe(1);
  });

  it("suppresses the address and audits it on a permanent bounce", async () => {
    configureResend();
    const message = await fixtureMessage({ toAddress: "hard-bounce@example.test" });

    const response = await webhookRoute(signedRequest(bouncedEvent(message.providerMessageId!, "Permanent")));
    expect(response.status).toBe(202);

    const updated = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe("BOUNCED");

    const suppression = await testPrisma.emailSuppression.findUnique({ where: { address: "hard-bounce@example.test" } });
    expect(suppression?.reason).toBe("hard_bounce");

    const audit = await testPrisma.auditEvent.findFirst({ where: { action: "email_suppression.added", entityId: "hard-bounce@example.test" } });
    expect(audit).not.toBeNull();
  });

  it("does not suppress on a transient (non-permanent) bounce", async () => {
    configureResend();
    const message = await fixtureMessage({ toAddress: "soft-bounce@example.test" });

    await webhookRoute(signedRequest(bouncedEvent(message.providerMessageId!, "Transient")));

    const updated = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe("BOUNCED");
    expect(await testPrisma.emailSuppression.findUnique({ where: { address: "soft-bounce@example.test" } })).toBeNull();
  });

  it("always suppresses on a complaint", async () => {
    configureResend();
    const message = await fixtureMessage({ toAddress: "complainer@example.test" });

    const response = await webhookRoute(signedRequest(complainedEvent(message.providerMessageId!)));
    expect(response.status).toBe(202);

    const updated = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(updated.status).toBe("COMPLAINED");
    const suppression = await testPrisma.emailSuppression.findUnique({ where: { address: "complainer@example.test" } });
    expect(suppression?.reason).toBe("complaint");
  });

  it("safely ignores an unknown/untracked event type without erroring", async () => {
    configureResend();
    const message = await fixtureMessage();

    const response = await webhookRoute(
      signedRequest({ type: "email.opened", created_at: new Date().toISOString(), data: { email_id: message.providerMessageId!, created_at: new Date().toISOString(), from: "x", to: ["y"], subject: "z" } }),
    );
    expect(response.status).toBe(202);

    const unchanged = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(unchanged.status).toBe("SENT");
  });

  it("safely no-ops for an event referencing a message this app never sent", async () => {
    configureResend();
    const response = await webhookRoute(signedRequest(deliveredEvent("unknown-message-id")));
    expect(response.status).toBe(202);
  });
});
