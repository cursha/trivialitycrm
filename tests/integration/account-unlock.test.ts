import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { unlockUserAccount } from "../../src/app/(dashboard)/settings/users/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("account unlock", () => {
  it("requires manage_users", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(unlockUserAccount("whatever")).rejects.toThrow();
  });

  it("clears failedLoginAttempts and lockedUntil, and audits the action", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const lockedUser = await createTestUser({ roleId: salespersonRole.id });
    await testPrisma.user.update({ where: { id: lockedUser.id }, data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) } });

    await unlockUserAccount(lockedUser.id);

    const result = await testPrisma.user.findUniqueOrThrow({ where: { id: lockedUser.id } });
    expect(result.failedLoginAttempts).toBe(0);
    expect(result.lockedUntil).toBeNull();

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "user.unlocked", entityId: lockedUser.id } });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorId).toBe(admin.id);
  });
});
