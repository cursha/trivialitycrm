import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { requestPasswordReset, getPendingPasswordResetRequests } from "../../src/lib/auth/password-reset";
import { submitForgotPassword } from "../../src/app/forgot-password/actions";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function formDataFor(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

describe("requestPasswordReset", () => {
  it("creates a pending request for a known, active user", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id, email: "requester@example.test" });

    await requestPasswordReset("requester@example.test");

    const pending = await getPendingPasswordResetRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].userId).toBe(user.id);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "password_reset.requested", entityId: user.id } });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorId).toBeNull();
  });

  it("is a silent no-op for an unknown email — no pending request created", async () => {
    await requestPasswordReset("nobody@example.test");
    expect(await getPendingPasswordResetRequests()).toHaveLength(0);
  });

  it("is a silent no-op for a disabled account", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: role.id, email: "disabled@example.test", disabled: true });

    await requestPasswordReset("disabled@example.test");
    expect(await getPendingPasswordResetRequests()).toHaveLength(0);
  });

  it("does not create a duplicate pending request for the same user", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: role.id, email: "repeat@example.test" });

    await requestPasswordReset("repeat@example.test");
    await requestPasswordReset("repeat@example.test");
    await requestPasswordReset("repeat@example.test");

    expect(await getPendingPasswordResetRequests()).toHaveLength(1);
  });
});

describe("submitForgotPassword server action", () => {
  it("always returns the same generic submitted state, matched or not", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: role.id, email: "known@example.test" });

    const known = await submitForgotPassword(undefined, formDataFor("known@example.test"));
    const unknown = await submitForgotPassword(undefined, formDataFor("unknown@example.test"));

    expect(known).toEqual({ submitted: true });
    expect(unknown).toEqual({ submitted: true });
  });

  it("rejects an invalid email with a validation error, not the generic message", async () => {
    const result = await submitForgotPassword(undefined, formDataFor("not-an-email"));
    expect(result).toEqual({ error: expect.any(String) });
  });
});
