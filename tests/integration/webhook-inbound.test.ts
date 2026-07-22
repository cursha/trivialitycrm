import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser } from "../helpers/fixtures";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { buildMockWebhookBody } from "../../src/lib/comms/providers/mock";
import { POST as webhookRoute } from "../../src/app/api/comms/webhooks/[provider]/route";

const TEST_KEY = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(async () => {
  await resetDatabase();
  mutableEnv.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  resetEnvCacheForTests();
});

function params(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

async function subscribedConnection(overrides: { subscriptionId?: string; clientState?: string } = {}) {
  const role = await createRoleWithPermissions(`Sender-${crypto.randomUUID()}`, []);
  const user = await createTestUser({ roleId: role.id });
  return testPrisma.providerConnection.create({
    data: {
      userId: user.id,
      provider: "MICROSOFT",
      providerAccountEmail: "salesperson@example.test",
      encryptedAccessToken: encryptToken("real-access-token"),
      encryptedRefreshToken: encryptToken("real-refresh-token"),
      scopes: ["Mail.Read"],
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "CONNECTED",
      inboundSubscriptionId: overrides.subscriptionId ?? "sub-1",
      inboundClientState: overrides.clientState ?? "correct-secret",
    },
  });
}

function postWebhook(body: string) {
  return webhookRoute(new Request("http://localhost/api/comms/webhooks/microsoft", { method: "POST", body }), params("microsoft"));
}

describe("POST /api/comms/webhooks/[provider]", () => {
  it("404s on an unrecognized provider slug", async () => {
    const response = await webhookRoute(new Request("http://localhost/api/comms/webhooks/bogus", { method: "POST", body: "{}" }), params("bogus"));
    expect(response.status).toBe(404);
  });

  it("echoes back a validationToken query param verbatim as plain text (Graph's subscription handshake)", async () => {
    const response = await webhookRoute(
      new Request("http://localhost/api/comms/webhooks/microsoft?validationToken=abc123", { method: "POST" }),
      params("microsoft"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("abc123");
  });

  it("responds 400 on a malformed payload", async () => {
    const response = await postWebhook("not json");
    expect(response.status).toBe(400);
  });

  it("silently drops (202, no WebhookEvent) a notification whose clientState doesn't match the subscription's stored secret", async () => {
    await subscribedConnection({ subscriptionId: "sub-1", clientState: "correct-secret" });
    const body = buildMockWebhookBody([
      { subscriptionId: "sub-1", clientState: "wrong-secret", fromAddress: "lead@example.com", subject: "Hi", bodyHtml: "Hi" },
    ]);

    const response = await postWebhook(body);
    expect(response.status).toBe(202);
    expect(await testPrisma.webhookEvent.count()).toBe(0);
  });

  it("silently drops a notification for an unknown subscriptionId", async () => {
    const body = buildMockWebhookBody([
      { subscriptionId: "never-subscribed", clientState: "anything", fromAddress: "lead@example.com", subject: "Hi", bodyHtml: "Hi" },
    ]);

    const response = await postWebhook(body);
    expect(response.status).toBe(202);
    expect(await testPrisma.webhookEvent.count()).toBe(0);
  });

  it("records exactly one WebhookEvent for a verified notification, and a redelivery of the same notification is a no-op", async () => {
    await subscribedConnection({ subscriptionId: "sub-1", clientState: "correct-secret" });
    const body = buildMockWebhookBody([
      { subscriptionId: "sub-1", clientState: "correct-secret", fromAddress: "lead@example.com", subject: "Hi", bodyHtml: "Hi" },
    ]);

    const first = await postWebhook(body);
    expect(first.status).toBe(202);
    expect(await testPrisma.webhookEvent.count()).toBe(1);

    const redelivery = await postWebhook(body);
    expect(redelivery.status).toBe(202);
    expect(await testPrisma.webhookEvent.count()).toBe(1);
  });
});
