import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { setRolePermission, duplicateRole, createRole } from "../../src/app/(dashboard)/settings/roles/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("roles management", () => {
  it("requires manage_roles, not manage_users, to edit roles (Module 8A regate)", async () => {
    const role = await createRoleWithPermissions("Manager", ["manage_users"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const fd = new FormData();
    fd.set("name", "New Role");
    await expect(createRole(undefined, fd)).rejects.toThrow();
  });

  it("duplicates a role's full permission grant set under a new name", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_roles", "view_all_leads", "edit_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const result = await duplicateRole(role.id, "Administrator Copy");
    expect(result?.error).toBeUndefined();

    const copy = await testPrisma.role.findFirstOrThrow({ where: { name: "Administrator Copy" }, include: { permissions: { where: { allowed: true } } } });
    expect(copy.permissions).toHaveLength(3);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "role.duplicated" } });
    expect(auditEvent).not.toBeNull();
  });

  it("prevents revoking manage_users or manage_roles from Administrator when no other active role would grant it", async () => {
    const role = await createRoleWithPermissions("Administrator", ["manage_roles", "manage_users"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const manageUsersPermission = await testPrisma.permission.findUniqueOrThrow({ where: { key: "manage_users" } });

    const result = await setRolePermission(role.id, manageUsersPermission.id, false);
    expect(result?.error).toMatch(/no active role able to manage users or roles/);

    const stillGranted = await testPrisma.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: role.id, permissionId: manageUsersPermission.id } } });
    expect(stillGranted?.allowed).toBe(true);

    const blockedEvent = await testPrisma.auditEvent.findFirst({ where: { action: "role.permission_changed", success: false } });
    expect(blockedEvent).not.toBeNull();
  });

  it("allows revoking manage_users from Administrator when another active role already grants it", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_roles", "manage_users"]);
    await createRoleWithPermissions("Manager", ["manage_users"]);
    const user = await createTestUser({ roleId: adminRole.id });
    await loginAs(user.id);

    const manageUsersPermission = await testPrisma.permission.findUniqueOrThrow({ where: { key: "manage_users" } });
    const result = await setRolePermission(adminRole.id, manageUsersPermission.id, false);
    expect(result?.error).toBeUndefined();
  });

  it("permission rows carry a category and description after the seed backfill shape", async () => {
    // Simulates what prisma/seed.ts writes — confirms the schema/migration
    // actually persists these fields (a full seed run is exercised
    // end-to-end via the manual `npx prisma db seed` verification, not
    // re-run inside the test suite).
    const permission = await testPrisma.permission.create({ data: { key: "test_permission", label: "Test", category: "Administration", description: "A test permission." } });
    const fetched = await testPrisma.permission.findUniqueOrThrow({ where: { id: permission.id } });
    expect(fetched.category).toBe("Administration");
    expect(fetched.description).toBe("A test permission.");
  });
});
