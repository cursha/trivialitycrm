import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser } from "../helpers/fixtures";
import { encryptToken } from "../../src/lib/comms/token-crypto";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { ensureInboundSubscription, runInboundSubscriptionTick } from "../../src/lib/comms/inbound-sync";

const TEST_KEY = "SRvbw8Ualx2XC/Ekfrk0RWORk0fg8/dcL1kL5krkqbk=";
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(async () => {
  await resetDatabase();
  mutableEnv.TOKEN_ENCRYPTION_KEY = TEST_KEY;
  mutableEnv.APP_URL = "https://crm.example.test";
  resetEnvCacheForTests();
});

afterEach(() => {
  delete mutableEnv.APP_URL;
  resetEnvCacheForTests();
});

async function connectedUser() {
  const role = await createRoleWithPermissions(`Sender-${crypto.randomUUID()}`, []);
  return createTestUser({ roleId: role.id });
}

async function connection(userId: string, overrides: Partial<{ provider: "MICROSOFT" | "GOOGLE"; status: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR"; inboundSubscriptionId: string | null; inboundSubscriptionExpiresAt: Date | null }> = {}) {
  return testPrisma.providerConnection.create({
    data: {
      userId,
      provider: overrides.provider ?? "MICROSOFT",
      providerAccountEmail: "salesperson@example.test",
      encryptedAccessToken: encryptToken("real-access-token"),
      encryptedRefreshToken: encryptToken("real-refresh-token"),
      scopes: ["Mail.Read"],
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: overrides.status ?? "CONNECTED",
      inboundSubscriptionId: overrides.inboundSubscriptionId,
      inboundSubscriptionExpiresAt: overrides.inboundSubscriptionExpiresAt,
    },
  });
}

describe("ensureInboundSubscription", () => {
  it("creates a subscription for a connection that has none yet", async () => {
    const user = await connectedUser();
    const conn = await connection(user.id);

    await ensureInboundSubscription(conn.id);

    const updated = await testPrisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(updated.inboundSubscriptionId).toContain("mock-sub-");
    expect(updated.inboundClientState).toBeTruthy();
    expect(updated.inboundSubscriptionExpiresAt).not.toBeNull();
  });

  it("renews a subscription nearing expiry, keeping the same subscriptionId", async () => {
    const user = await connectedUser();
    const nearExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour — inside the 24h renewal margin
    const conn = await connection(user.id, { inboundSubscriptionId: "existing-sub", inboundSubscriptionExpiresAt: nearExpiry });

    await ensureInboundSubscription(conn.id);

    const updated = await testPrisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(updated.inboundSubscriptionId).toBe("existing-sub");
    expect(updated.inboundSubscriptionExpiresAt!.getTime()).toBeGreaterThan(nearExpiry.getTime());
  });

  it("leaves a subscription alone when it isn't near expiry", async () => {
    const user = await connectedUser();
    const farExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const conn = await connection(user.id, { inboundSubscriptionId: "existing-sub", inboundSubscriptionExpiresAt: farExpiry });

    await ensureInboundSubscription(conn.id);

    const updated = await testPrisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(updated.inboundSubscriptionExpiresAt!.getTime()).toBe(farExpiry.getTime());
  });

  it("does nothing for a connection that isn't CONNECTED", async () => {
    const user = await connectedUser();
    const conn = await connection(user.id, { status: "ERROR" });

    await ensureInboundSubscription(conn.id);

    const updated = await testPrisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(updated.inboundSubscriptionId).toBeNull();
  });
});

describe("runInboundSubscriptionTick", () => {
  it("ensures every CONNECTED connection and isolates one connection's failure from the rest", async () => {
    const userA = await connectedUser();
    const connA = await connection(userA.id, { provider: "MICROSOFT" });
    const userB = await connectedUser();
    // Google's inbound methods are unimplemented (Phase D2 scoped to
    // Microsoft only — see google.ts) — under NODE_ENV=test the factory
    // always returns MockEmailProvider regardless of `provider`, so this
    // doesn't actually exercise GoogleProvider's real throw; it exists to
    // prove one connection's failure (however it might arise in
    // production) never blocks the tick from handling every other one.
    const connB = await connection(userB.id, { provider: "GOOGLE" });

    const result = await runInboundSubscriptionTick();
    expect(result.ok).toBe(2);
    expect(result.failed).toBe(0);

    const updatedA = await testPrisma.providerConnection.findUniqueOrThrow({ where: { id: connA.id } });
    const updatedB = await testPrisma.providerConnection.findUniqueOrThrow({ where: { id: connB.id } });
    expect(updatedA.inboundSubscriptionId).toContain("mock-sub-");
    expect(updatedB.inboundSubscriptionId).toContain("mock-sub-");
  });

  it("skips a disconnected connection", async () => {
    const user = await connectedUser();
    await connection(user.id, { status: "REVOKED" });

    const result = await runInboundSubscriptionTick();
    expect(result.ok).toBe(0);
    expect(result.failed).toBe(0);
  });
});
