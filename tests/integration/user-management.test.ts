import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { createUser, resetUserPassword } from "../../src/app/(dashboard)/settings/users/actions";
import { login } from "../../src/app/login/actions";
import { ForbiddenError } from "../../src/lib/auth/permissions";
import { RedirectSignal } from "../setup/mock-next";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

function formDataFrom(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("createUser (Add a user)", () => {
  it("creates a user with mustChangePassword set, and the temporary password the admin typed actually works to log in", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const salesRole = await createRoleWithPermissions("Salesperson", []);

    const result = await createUser(
      undefined,
      formDataFrom({
        name: "New Hire",
        email: "newhire@example.test",
        roleId: salesRole.id,
        initialPassword: "Temp-Pass1!",
      }),
    );
    expect(result?.error).toBeUndefined();

    const created = await testPrisma.user.findUniqueOrThrow({ where: { email: "newhire@example.test" } });
    expect(created.mustChangePassword).toBe(true);

    // The exact value the admin typed must work to log in.
    resetFakeCookies();
    let redirectUrl: string | null = null;
    try {
      await login(undefined, formDataFrom({ email: "newhire@example.test", password: "Temp-Pass1!" }));
      expect.fail("expected login() to redirect on success");
    } catch (error) {
      if (error instanceof RedirectSignal) redirectUrl = error.url;
      else throw error;
    }
    expect(redirectUrl).toBe("/change-password"); // mustChangePassword routes here, not /dashboard
  });

  it("rejects a temporary password that fails the complexity rules", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);
    const salesRole = await createRoleWithPermissions("Salesperson 2", []);

    const result = await createUser(
      undefined,
      formDataFrom({ name: "New Hire", email: "weak@example.test", roleId: salesRole.id, initialPassword: "weak" }),
    );

    expect(result?.error).toBeTruthy();
    expect(await testPrisma.user.findUnique({ where: { email: "weak@example.test" } })).toBeNull();
  });

  it("requires manage_users permission", async () => {
    const role = await createRoleWithPermissions("No Permissions", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(
      createUser(undefined, formDataFrom({ name: "X", email: "x@example.test", roleId: role.id, initialPassword: "Temp-Pass1!" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("resetUserPassword (Reset password)", () => {
  it("sets a new temporary password that works, invalidates existing sessions, and clears any lockout", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);

    const targetRole = await createRoleWithPermissions("Salesperson 3", []);
    const target = await createTestUser({ roleId: targetRole.id, email: "target@example.test" });

    // Simulate a lockout and an existing session, both of which a reset should clear.
    await testPrisma.user.update({
      where: { id: target.id },
      data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
    });
    await testPrisma.session.create({
      data: { userId: target.id, tokenHash: "irrelevant-existing-session-hash", expiresAt: new Date(Date.now() + 60_000) },
    });

    const result = await resetUserPassword(undefined, formDataFrom({ userId: target.id, newPassword: "Brand-New-1!" }));
    expect(result?.error).toBeUndefined();

    const updated = await testPrisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.mustChangePassword).toBe(true);
    expect(updated.failedLoginAttempts).toBe(0);
    expect(updated.lockedUntil).toBeNull();
    expect(await testPrisma.session.count({ where: { userId: target.id } })).toBe(0);

    // The new value actually works.
    resetFakeCookies();
    let redirectUrl: string | null = null;
    try {
      await login(undefined, formDataFrom({ email: "target@example.test", password: "Brand-New-1!" }));
      expect.fail("expected login() to redirect on success");
    } catch (error) {
      if (error instanceof RedirectSignal) redirectUrl = error.url;
      else throw error;
    }
    expect(redirectUrl).toBe("/change-password");
  });

  it("rejects a weak replacement password without changing the existing hash", async () => {
    const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
    const admin = await createTestUser({ roleId: adminRole.id });
    await loginAs(admin.id);
    const targetRole = await createRoleWithPermissions("Salesperson 4", []);
    const target = await createTestUser({ roleId: targetRole.id });
    const originalHash = target.passwordHash;

    const result = await resetUserPassword(undefined, formDataFrom({ userId: target.id, newPassword: "weak" }));
    expect(result?.error).toBeTruthy();

    const unchanged = await testPrisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchanged.passwordHash).toBe(originalHash);
  });

  it("requires manage_users permission", async () => {
    const role = await createRoleWithPermissions("No Permissions 2", []);
    const user = await createTestUser({ roleId: role.id });
    await loginAs(user.id);

    await expect(resetUserPassword(undefined, formDataFrom({ userId: user.id, newPassword: "Brand-New-1!" }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
