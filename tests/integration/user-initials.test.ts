import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { setUserInitials } from "../../src/app/(dashboard)/settings/users/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function initialsOf(id: string) {
  return (await testPrisma.user.findUniqueOrThrow({ where: { id } })).initials;
}

describe("setUserInitials", () => {
  it("requires manage_users", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(setUserInitials(user.id, "JS")).rejects.toThrow();
  });

  it("stores two letters uppercase, audits it, and clears on blank", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ name: "Curt Skene", roleId: adminRole.id });
    await loginAs(admin.id);

    expect(await setUserInitials(admin.id, " cs ")).toBeUndefined();
    expect(await initialsOf(admin.id)).toBe("CS");

    const audit = await testPrisma.auditEvent.findFirstOrThrow({ where: { action: "user.initials_changed", entityId: admin.id } });
    expect(audit.beforeData).toEqual({ initials: null });
    expect(audit.afterData).toEqual({ initials: "CS" });

    expect(await setUserInitials(admin.id, "")).toBeUndefined();
    expect(await initialsOf(admin.id)).toBeNull();
  });

  it("rejects anything but two letters", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    for (const bad of ["C", "CSK", "C1", "C."]) {
      expect(await setUserInitials(admin.id, bad)).toEqual({ error: "Initials must be exactly two letters, like CS." });
    }
    expect(await initialsOf(admin.id)).toBeNull();
  });

  it("won't give two users the same initials", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ name: "Joe Staab", roleId: adminRole.id });
    const other = await createTestUser({ name: "Jane Smith", roleId: adminRole.id });
    await loginAs(admin.id);

    expect(await setUserInitials(admin.id, "JS")).toBeUndefined();
    expect(await setUserInitials(other.id, "js")).toEqual({ error: "JS is already used by another user." });
    expect(await initialsOf(other.id)).toBeNull();

    // Re-saving your own initials is fine.
    expect(await setUserInitials(admin.id, "JS")).toBeUndefined();
  });
});
