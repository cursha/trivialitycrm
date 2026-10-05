import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { renameUser } from "../../src/app/(dashboard)/settings/users/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("renameUser", () => {
  it("requires manage_users", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(renameUser(user.id, "New Name")).rejects.toThrow();
  });

  it("renames the user (trimmed), audits it, and rejects a blank name", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ name: "Administrator", roleId: adminRole.id });
    await loginAs(admin.id);

    expect(await renameUser(admin.id, "  Curt Skene  ")).toBeUndefined();
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: admin.id } })).name).toBe("Curt Skene");

    const audit = await testPrisma.auditEvent.findFirstOrThrow({ where: { action: "user.renamed", entityId: admin.id } });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.beforeData).toEqual({ name: "Administrator" });
    expect(audit.afterData).toEqual({ name: "Curt Skene" });

    expect(await renameUser(admin.id, "   ")).toEqual({ error: "Enter a name." });
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: admin.id } })).name).toBe("Curt Skene");
  });
});
