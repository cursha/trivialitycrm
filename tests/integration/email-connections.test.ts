import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { connectTitanAccount, disconnectMailboxAction } from "../../src/app/(dashboard)/settings/email-connections/actions";
import { getUsableAccessToken } from "../../src/lib/comms/connections";

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

async function connectableUser() {
  const role = await createRoleWithPermissions("MailboxConnector", ["connect_mailbox"]);
  const user = await createTestUser({ roleId: role.id });
  await loginAs(user.id);
  return user;
}

describe("connectTitanAccount", () => {
  it("stores an encrypted password and marks the connection CONNECTED", async () => {
    const user = await connectableUser();

    const result = await connectTitanAccount("sales@example.test", "correct-horse-battery-staple");
    expect(result).toHaveProperty("success", true);

    const connection = await testPrisma.providerConnection.findUniqueOrThrow({ where: { userId: user.id } });
    expect(connection.provider).toBe("TITAN");
    expect(connection.providerAccountEmail).toBe("sales@example.test");
    expect(connection.status).toBe("CONNECTED");
    expect(connection.encryptedRefreshToken).toBeNull();
    expect(connection.tokenExpiresAt).toBeNull();
    // Never the plaintext password, ciphertext only.
    expect(connection.encryptedAccessToken).not.toBe("correct-horse-battery-staple");
  });

  it("rejects a malformed email without creating a connection", async () => {
    const user = await connectableUser();
    const result = await connectTitanAccount("not-an-email", "some-password");
    expect(result).toHaveProperty("error");
    expect(await testPrisma.providerConnection.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it("rejects an empty password without creating a connection", async () => {
    const user = await connectableUser();
    const result = await connectTitanAccount("sales@example.test", "");
    expect(result).toHaveProperty("error");
    expect(await testPrisma.providerConnection.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it("rejects a user without connect_mailbox", async () => {
    const role = await createRoleWithPermissions("NoConnectAccess", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(connectTitanAccount("sales@example.test", "some-password")).rejects.toThrow();
  });

  it("reconnecting overwrites the previous Titan connection rather than duplicating it", async () => {
    const user = await connectableUser();
    await connectTitanAccount("old@example.test", "old-password");
    await connectTitanAccount("new@example.test", "new-password");

    const connections = await testPrisma.providerConnection.findMany({ where: { userId: user.id } });
    expect(connections).toHaveLength(1);
    expect(connections[0].providerAccountEmail).toBe("new@example.test");
  });
});

describe("getUsableAccessToken for a TITAN connection", () => {
  it("returns the decrypted password and account email with no refresh attempt", async () => {
    const user = await connectableUser();
    await connectTitanAccount("sales@example.test", "correct-horse-battery-staple");

    const account = await getUsableAccessToken(user.id);
    expect(account.accessToken).toBe("correct-horse-battery-staple");
    expect(account.accountEmail).toBe("sales@example.test");
    expect(account.refreshToken).toBe("");
  });
});

describe("disconnectMailboxAction for a TITAN connection", () => {
  it("deletes the connection with no provider-side revoke call (Titan has no revoke API)", async () => {
    const user = await connectableUser();
    await connectTitanAccount("sales@example.test", "correct-horse-battery-staple");

    await disconnectMailboxAction();
    expect(await testPrisma.providerConnection.findUnique({ where: { userId: user.id } })).toBeNull();
  });
});
