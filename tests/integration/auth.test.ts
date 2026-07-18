import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies, fakeCookies } from "../setup/mock-next";
import { getCurrentUser, requireUser } from "../../src/lib/auth/current-user";
import { RedirectSignal } from "../setup/mock-next";
import { hasPermission, requirePermission, ForbiddenError } from "../../src/lib/auth/permissions";
import { isLockedOut, recordFailedLogin, recordSuccessfulLogin } from "../../src/lib/auth/rate-limit";
import { createSession, destroySession, invalidateAllSessionsForUser } from "../../src/lib/auth/session";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

describe("session verification", () => {
  it("returns null with no session cookie", async () => {
    expect(await getCurrentUser()).toBeNull();
  });

  it("redirects to /login when requireUser() is called with no session", async () => {
    await expect(requireUser()).rejects.toBeInstanceOf(RedirectSignal);

    try {
      await requireUser();
      expect.fail("expected requireUser() to throw a redirect");
    } catch (error) {
      expect((error as RedirectSignal).url).toBe("/login");
    }
  });

  it("resolves the logged-in user for a valid session", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const user = await createTestUser({ name: "Ada Admin", roleId: role.id });

    await loginAs(user.id);

    const current = await getCurrentUser();
    expect(current?.id).toBe(user.id);
    expect(current?.name).toBe("Ada Admin");
  });

  it("treats an expired session as unauthenticated", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    // Force the just-created session into the past.
    await testPrisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await getCurrentUser()).toBeNull();
  });

  it("treats a disabled user's session as unauthenticated even if the row still exists", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    // Simulate a stale session surviving a disable that, in the normal
    // application flow, would have deleted it — the current-user check
    // must still reject it (defense in depth).
    await testPrisma.user.update({ where: { id: user.id }, data: { disabled: true } });

    expect(await getCurrentUser()).toBeNull();
  });

  it("logout deletes the session so it can no longer authenticate", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    expect(await getCurrentUser()).not.toBeNull();

    await destroySession();

    expect(await getCurrentUser()).toBeNull();
    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("disabling a user invalidates all of their sessions immediately", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await createSession(user.id);
    await createSession(user.id);
    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(2);

    await invalidateAllSessionsForUser(user.id);

    expect(await testPrisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("permission enforcement", () => {
  it("hasPermission is true only for a granted key", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads", "add_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const current = await getCurrentUser();

    expect(hasPermission(current, "view_assigned_leads")).toBe(true);
    expect(hasPermission(current, "manage_users")).toBe(false);
  });

  it("requirePermission throws ForbiddenError for a missing permission", async () => {
    const role = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);
    const current = await getCurrentUser();

    expect(() => requirePermission(current, "manage_users")).toThrow(ForbiddenError);
  });

  it("hasPermission is false for a null (unauthenticated) user", () => {
    expect(hasPermission(null, "view_all_leads")).toBe(false);
  });
});

describe("login rate limiting", () => {
  it("locks the account after five failed attempts and clears on success", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });

    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(user.id);
    }

    const lockedUser = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isLockedOut(lockedUser)).toBe(true);

    await recordSuccessfulLogin(user.id);
    const clearedUser = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isLockedOut(clearedUser)).toBe(false);
    expect(clearedUser.failedLoginAttempts).toBe(0);
  });

  it("does not lock out before the threshold", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });

    for (let i = 0; i < 4; i++) {
      await recordFailedLogin(user.id);
    }

    const stillOpenUser = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isLockedOut(stillOpenUser)).toBe(false);
  });
});

describe("session token storage", () => {
  it("never stores the raw token — only its hash", async () => {
    const role = await createRoleWithPermissions("Administrator", ["view_all_leads"]);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    const rawToken = fakeCookies.get("session")?.value;
    expect(rawToken).toBeTruthy();

    const session = await testPrisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.tokenHash).not.toBe(rawToken);
    expect(session.tokenHash).toHaveLength(64); // sha256 hex digest
  });
});
