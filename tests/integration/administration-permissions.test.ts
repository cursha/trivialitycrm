import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { requireUser } from "../../src/lib/auth/current-user";
import { requirePermission } from "../../src/lib/auth/permissions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("view_administration / view_audit_log page gates", () => {
  it("view_administration is required for the Administration home and is not granted by default to non-admin roles", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const currentUser = await requireUser();
    expect(() => requirePermission(currentUser, "view_administration")).toThrow();
  });

  it("view_administration is satisfied once granted", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_administration"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const currentUser = await requireUser();
    expect(() => requirePermission(currentUser, "view_administration")).not.toThrow();
  });

  it("view_audit_log gates the audit log page independently of export_audit_log", async () => {
    const role = await createRoleWithPermissions("Manager", ["view_audit_log"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const currentUser = await requireUser();
    expect(() => requirePermission(currentUser, "view_audit_log")).not.toThrow();
    expect(() => requirePermission(currentUser, "export_audit_log")).toThrow();
  });
});
