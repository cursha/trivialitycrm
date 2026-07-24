import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { requestPasswordReset } from "../../src/lib/auth/password-reset";
import { fetchPendingPasswordResetRequests, generatePasswordResetLinkAction } from "../../src/app/(dashboard)/settings/users/actions";
import { SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS } from "../../src/lib/transactional/providers/mock";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function pendingRequestFor(email: string) {
  await requestPasswordReset(email);
  const [pending] = await fetchPendingPasswordResetRequests();
  return pending;
}

async function loggedInAdmin() {
  const adminRole = await createRoleWithPermissions("Administrator", ["manage_users"]);
  const admin = await createTestUser({ roleId: adminRole.id });
  await loginAs(admin.id);
  return admin;
}

describe("generatePasswordResetLinkAction — Module Nine email wiring", () => {
  it("sends no email and behaves exactly as before when emailSendingEnabled is false (the default)", async () => {
    await loggedInAdmin();
    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: salespersonRole.id, email: "manual-relay@example.test" });
    const request = await pendingRequestFor("manual-relay@example.test");

    const result = await generatePasswordResetLinkAction(request.id);
    expect(result.ok).toBe(true);
    expect(await testPrisma.transactionalEmailMessage.count()).toBe(0);
  });

  it("queues a PASSWORD_RESET email containing the link when emailSendingEnabled is true", async () => {
    await testPrisma.integrationSettings.upsert({ where: { id: 1 }, update: { emailSendingEnabled: true }, create: { id: 1, emailSendingEnabled: true } });
    await loggedInAdmin();
    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: salespersonRole.id, email: "auto-email@example.test" });
    const request = await pendingRequestFor("auto-email@example.test");

    const result = await generatePasswordResetLinkAction(request.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const token = new URL(result.link).searchParams.get("token");
    const message = await testPrisma.transactionalEmailMessage.findFirstOrThrow({ where: { purpose: "PASSWORD_RESET" } });
    expect(message.toAddress).toBe("auto-email@example.test");
    expect(message.body).toContain(token);
    expect(message.createdById).toBeNull(); // system-triggered, not an admin's own send
  }, 15000);

  it("still returns the token successfully even if the best-effort email send would fail", async () => {
    await testPrisma.integrationSettings.upsert({ where: { id: 1 }, update: { emailSendingEnabled: true }, create: { id: 1, emailSendingEnabled: true } });
    await loggedInAdmin();
    const salespersonRole = await createRoleWithPermissions("Salesperson", ["view_assigned_leads"]);
    await createTestUser({ roleId: salespersonRole.id, email: SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS });
    const request = await pendingRequestFor(SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS);

    const result = await generatePasswordResetLinkAction(request.id);
    // sendSystemEmail() only queues (the mock failure fires later, inside
    // processQueuedSystemEmail, which nothing here calls) — this test
    // confirms the admin-facing action never depends on that outcome
    // either way, per generatePasswordResetLink()'s best-effort contract.
    expect(result.ok).toBe(true);
  }, 15000);
});
