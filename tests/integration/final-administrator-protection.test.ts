import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { setUserRole, setUserDisabled } from "../../src/app/(dashboard)/settings/users/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function adminAndSalespersonRoles() {
  const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
  const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
  return { adminRole, salespersonRole };
}

describe("final active Administrator protection", () => {
  it("blocks demoting the last active Administrator, and audits the blocked attempt", async () => {
    const { adminRole, salespersonRole } = await adminAndSalespersonRoles();
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const result = await setUserRole(admin.id, salespersonRole.id);
    expect(result?.error).toMatch(/last active Administrator/);

    const stillAdmin = await testPrisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stillAdmin.roleId).toBe(adminRole.id);

    const blockedEvent = await testPrisma.auditEvent.findFirst({ where: { action: "user.role_changed", success: false } });
    expect(blockedEvent).not.toBeNull();
  });

  it("allows demoting an Administrator when another active Administrator remains", async () => {
    const { adminRole, salespersonRole } = await adminAndSalespersonRoles();
    const admin1 = await createTestUser({ roleId: adminRole.id, email: "admin1@example.test" });
    const admin2 = await createTestUser({ roleId: adminRole.id, email: "admin2@example.test" });
    await loginAs(admin1.id);

    const result = await setUserRole(admin2.id, salespersonRole.id);
    expect(result?.error).toBeUndefined();

    const demoted = await testPrisma.user.findUniqueOrThrow({ where: { id: admin2.id } });
    expect(demoted.roleId).toBe(salespersonRole.id);
  });

  it("prevents an Administrator from deactivating their own account (self-deactivation guard)", async () => {
    const { adminRole } = await adminAndSalespersonRoles();
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const result = await setUserDisabled(admin.id, true);
    expect(result?.error).toMatch(/cannot deactivate your own account/);

    const stillActive = await testPrisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stillActive.disabled).toBe(false);
  });

  it("blocks deactivating the last active Administrator even when a different user (not the target) acts", async () => {
    // A Manager-shaped role that's also been granted manage_users (an
    // unusual but valid grant) is the actor here — distinct from the sole
    // remaining Administrator being targeted, so this isolates the
    // last-admin guard from the self-deactivation guard (which only fires
    // when actor.id === target id).
    const { adminRole } = await adminAndSalespersonRoles();
    const managerRole = await createRoleWithPermissions("Manager", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id, email: "admin@example.test" });
    const manager = await createTestUser({ roleId: managerRole.id, email: "manager@example.test" });
    await loginAs(manager.id);

    const result = await setUserDisabled(admin.id, true);
    expect(result?.error).toMatch(/last active Administrator/);

    const stillActive = await testPrisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(stillActive.disabled).toBe(false);
  });
});
