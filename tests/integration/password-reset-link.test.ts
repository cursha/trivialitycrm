import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies, RedirectSignal } from "../setup/mock-next";
import { requestPasswordReset, completePasswordReset } from "../../src/lib/auth/password-reset";
import { fetchPendingPasswordResetRequests, generatePasswordResetLinkAction, dismissPasswordResetRequestAction } from "../../src/app/(dashboard)/settings/users/actions";
import { submitPasswordReset } from "../../src/app/reset-password/actions";
import { verifyPassword } from "../../src/lib/auth/password";
import { createSession } from "../../src/lib/auth/session";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function pendingRequestFor(email: string) {
  await requestPasswordReset(email);
  const [pending] = await fetchPendingPasswordResetRequests();
  return pending;
}

function resetFormDataFor(token: string, newPassword: string, confirmPassword = newPassword): FormData {
  const fd = new FormData();
  fd.set("token", token);
  fd.set("newPassword", newPassword);
  fd.set("confirmPassword", confirmPassword);
  return fd;
}

describe("generatePasswordResetLinkAction", () => {
  it("requires manage_users", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(generatePasswordResetLinkAction("whatever")).rejects.toThrow();
  });

  it("reveals a one-time link, embeds a token that resolves back to the requester, and marks the request resolved", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const requester = await createTestUser({ roleId: salespersonRole.id, email: "needs-reset@example.test" });
    const request = await pendingRequestFor("needs-reset@example.test");

    const result = await generatePasswordResetLinkAction(request.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const url = new URL(result.link);
    const token = url.searchParams.get("token");
    expect(token).toBeTruthy();

    // Only the hash is ever persisted — the raw token from the link must not appear verbatim in the DB.
    const tokenRow = await testPrisma.passwordResetToken.findFirstOrThrow({ where: { userId: requester.id } });
    expect(tokenRow.tokenHash).not.toBe(token);
    expect(tokenRow.tokenHash).toHaveLength(64);

    expect(await fetchPendingPasswordResetRequests()).toHaveLength(0);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "password_reset.link_generated", entityId: requester.id } });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorId).toBe(admin.id);
  });

  it("returns an error for an already-resolved request rather than issuing a second token", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: salespersonRole.id, email: "already@example.test" });
    const request = await pendingRequestFor("already@example.test");

    await generatePasswordResetLinkAction(request.id);
    const second = await generatePasswordResetLinkAction(request.id);
    expect(second.ok).toBe(false);
  });
});

describe("dismissPasswordResetRequestAction", () => {
  it("resolves the request without issuing a token, and audits it", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const requester = await createTestUser({ roleId: salespersonRole.id, email: "dismiss-me@example.test" });
    const request = await pendingRequestFor("dismiss-me@example.test");

    await dismissPasswordResetRequestAction(request.id);

    expect(await fetchPendingPasswordResetRequests()).toHaveLength(0);
    expect(await testPrisma.passwordResetToken.count({ where: { userId: requester.id } })).toBe(0);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "password_reset.dismissed", entityId: requester.id } });
    expect(auditEvent?.actorId).toBe(admin.id);
  });
});

describe("completePasswordReset", () => {
  async function issueToken(email: string) {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);
    const request = await pendingRequestFor(email);
    const result = await generatePasswordResetLinkAction(request.id);
    if (!result.ok) throw new Error("expected link generation to succeed");
    resetFakeCookies();
    return new URL(result.link).searchParams.get("token") as string;
  }

  it("sets a new password, clears mustChangePassword and lockout, and invalidates existing sessions", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id, email: "resetme@example.test" });
    await testPrisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true, failedLoginAttempts: 3, lockedUntil: new Date(Date.now() + 60000) } });
    await createSession(user.id);
    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(1);

    const token = await issueToken("resetme@example.test");

    const result = await completePasswordReset(token, "Brand-New-Passw0rd!");
    expect(result.ok).toBe(true);

    const updated = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.mustChangePassword).toBe(false);
    expect(updated.failedLoginAttempts).toBe(0);
    expect(updated.lockedUntil).toBeNull();
    expect(await verifyPassword("Brand-New-Passw0rd!", updated.passwordHash)).toBe(true);
    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(0);

    const auditEvent = await testPrisma.auditEvent.findFirst({ where: { action: "password_reset.completed", entityId: user.id } });
    expect(auditEvent?.actorId).toBeNull();
  });

  it("rejects a second use of the same token", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: role.id, email: "onceonly@example.test" });
    const token = await issueToken("onceonly@example.test");

    const first = await completePasswordReset(token, "First-Passw0rd!");
    expect(first.ok).toBe(true);

    const second = await completePasswordReset(token, "Second-Passw0rd!");
    expect(second.ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: role.id, email: "expired@example.test" });
    const token = await issueToken("expired@example.test");

    await testPrisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await completePasswordReset(token, "Whatever-Passw0rd!");
    expect(result.ok).toBe(false);
  });

  it("rejects a garbage token", async () => {
    const result = await completePasswordReset("not-a-real-token", "Whatever-Passw0rd!");
    expect(result.ok).toBe(false);
  });

  it("a fresh link generation invalidates the previous unused token for that user", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: salespersonRole.id, email: "regenerate@example.test" });

    const firstRequest = await pendingRequestFor("regenerate@example.test");
    const firstResult = await generatePasswordResetLinkAction(firstRequest.id);
    if (!firstResult.ok) throw new Error("expected first link generation to succeed");
    const firstToken = new URL(firstResult.link).searchParams.get("token") as string;

    const secondRequest = await pendingRequestFor("regenerate@example.test");
    const secondResult = await generatePasswordResetLinkAction(secondRequest.id);
    if (!secondResult.ok) throw new Error("expected second link generation to succeed");

    const outcome = await completePasswordReset(firstToken, "Should-Not-Work-1!");
    expect(outcome.ok).toBe(false);
  });
});

describe("submitPasswordReset server action", () => {
  it("redirects to /login on success", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: salespersonRole.id, email: "form-reset@example.test" });
    const request = await pendingRequestFor("form-reset@example.test");
    const result = await generatePasswordResetLinkAction(request.id);
    if (!result.ok) throw new Error("expected link generation to succeed");
    const token = new URL(result.link).searchParams.get("token") as string;
    resetFakeCookies();

    let redirectUrl: string | null = null;
    try {
      await submitPasswordReset(undefined, resetFormDataFor(token, "Form-New-Passw0rd!"));
      expect.fail("expected submitPasswordReset to redirect on success");
    } catch (error) {
      if (error instanceof RedirectSignal) redirectUrl = error.url;
      else throw error;
    }
    expect(redirectUrl).toBe("/login");
  });

  it("rejects mismatched passwords with a validation error", async () => {
    const result = await submitPasswordReset(undefined, resetFormDataFor("some-token", "Password-One1!", "Password-Two2!"));
    expect(result?.error).toBeTruthy();
  });

  it("shows the generic invalid-link error for an unknown token", async () => {
    const result = await submitPasswordReset(undefined, resetFormDataFor("bogus-token", "Whatever-Passw0rd!"));
    expect(result?.error).toMatch(/invalid or has expired/);
  });
});
