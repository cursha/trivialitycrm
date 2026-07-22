import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { revokeUserSessions } from "../../src/app/(dashboard)/settings/users/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("session revocation", () => {
  it("requires manage_users", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(revokeUserSessions("whatever")).rejects.toThrow();
  });

  it("deletes every session for the target user and audits the action", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const target = await createTestUser({ roleId: salespersonRole.id });
    await testPrisma.session.createMany({
      data: [
        { userId: target.id, tokenHash: "hash-1", expiresAt: new Date(Date.now() + 1000 * 60 * 60) },
        { userId: target.id, tokenHash: "hash-2", expiresAt: new Date(Date.now() + 1000 * 60 * 60) },
      ],
    });
    expect(await testPrisma.session.count({ where: { userId: target.id } })).toBe(2);

    await revokeUserSessions(target.id);

    expect(await testPrisma.session.count({ where: { userId: target.id } })).toBe(0);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "user.sessions_revoked", entityId: target.id } });
    expect(auditEvent).not.toBeNull();
  });
});
