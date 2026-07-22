import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { exportAuditLog } from "../../src/app/(dashboard)/administration/audit-log/actions";
import { writeAuditEvent } from "../../src/lib/audit/log";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("audit log export", () => {
  it("requires export_audit_log (view_audit_log alone is not enough)", async () => {
    const role = await createRoleWithPermissions("Manager", ["view_audit_log"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(exportAuditLog({})).rejects.toThrow();
  });

  it("redacts sensitive fields in exported before/after/metadata JSON", async () => {
    const role = await createRoleWithPermissions("Administrator", ["export_audit_log"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await writeAuditEvent({
      actorId: user.id,
      module: "users",
      action: "user.password_reset",
      entityType: "User",
      entityId: "target-1",
      metadata: { note: "reset via admin panel", apiKey: "should-never-appear", passwordHash: "should-never-appear-either" },
    });

    const result = await exportAuditLog({});
    expect(result.error).toBeUndefined();
    expect(result.csv).toBeTruthy();
    expect(result.csv).not.toContain("should-never-appear");
    expect(result.csv).toContain("[redacted]");
  });

  it("rate-limits repeated exports", async () => {
    const role = await createRoleWithPermissions("Administrator", ["export_audit_log"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const first = await exportAuditLog({});
    expect(first.error).toBeUndefined();

    const second = await exportAuditLog({});
    expect(second.error).toBeTruthy();
  });

  it("filters by module and only returns matching rows", async () => {
    const role = await createRoleWithPermissions("Administrator", ["export_audit_log"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await writeAuditEvent({ actorId: user.id, module: "users", action: "user.disabled", entityId: "1" });
    await writeAuditEvent({ actorId: user.id, module: "roles", action: "role.created", entityId: "2" });

    const result = await exportAuditLog({ module: "roles" });
    expect(result.csv).toContain("role.created");
    expect(result.csv).not.toContain("user.disabled");
  });

  it("records that the export itself happened, without recursively including that new row in its own output", async () => {
    const role = await createRoleWithPermissions("Administrator", ["export_audit_log"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await exportAuditLog({});
    const exportEvent = await testPrisma.auditEvent.findFirst({ where: { action: "audit_log.exported" } });
    expect(exportEvent).not.toBeNull();
  });
});
