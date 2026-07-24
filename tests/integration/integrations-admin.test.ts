import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { createRoleWithPermissions, createTestUser, loginAs } from "../helpers/fixtures";
import { resetFakeCookies } from "../setup/mock-next";
import { requireUser } from "../../src/lib/auth/current-user";
import { requirePermission } from "../../src/lib/auth/permissions";
import { setAiIntegrationEnabled, testAiConnection, setEmailIntegrationEnabled, sendTestEmail } from "../../src/app/(dashboard)/administration/integrations/actions";
import { getIntegrationsStatus, getAiUsageRecords } from "../../src/app/(dashboard)/administration/integrations/queries";

beforeEach(async () => {
  await resetDatabase();
  resetFakeCookies();
});

async function userWithPermissions(permissions: string[]) {
  const role = await createRoleWithPermissions("Tester", permissions);
  const user = await createTestUser({ roleId: role.id });
  await loginAs(user.id);
  return user;
}

function testEmailFormData(toAddress: string) {
  const fd = new FormData();
  fd.set("toAddress", toAddress);
  return fd;
}

describe("Integrations page permission gate", () => {
  it("requires view_integrations", async () => {
    await userWithPermissions(["view_assigned_leads"]);
    const currentUser = await requireUser();
    expect(() => requirePermission(currentUser, "view_integrations")).toThrow();
  });
});

describe("setAiIntegrationEnabled", () => {
  it("requires manage_ai_integration", async () => {
    await userWithPermissions(["view_integrations"]);
    await expect(setAiIntegrationEnabled(true)).rejects.toThrow();
  });

  it("toggles AiSettings.researchEnabled and audits with the right action name", async () => {
    const user = await userWithPermissions(["manage_ai_integration"]);

    await setAiIntegrationEnabled(false);
    expect((await testPrisma.aiSettings.findUniqueOrThrow({ where: { id: 1 } })).researchEnabled).toBe(false);
    const disableAudit = await testPrisma.auditEvent.findFirst({ where: { action: "ai_integration.disabled" } });
    expect(disableAudit?.actorId).toBe(user.id);

    await setAiIntegrationEnabled(true);
    expect((await testPrisma.aiSettings.findUniqueOrThrow({ where: { id: 1 } })).researchEnabled).toBe(true);
    expect(await testPrisma.auditEvent.findFirst({ where: { action: "ai_integration.enabled" } })).not.toBeNull();
  });
});

describe("testAiConnection", () => {
  it("requires manage_ai_integration", async () => {
    await userWithPermissions(["view_integrations"]);
    await expect(testAiConnection()).rejects.toThrow();
  });

  it("is a safe no-op with a clear message in mock mode — never attempts a real call", async () => {
    await userWithPermissions(["manage_ai_integration"]);
    const result = await testAiConnection();
    expect(result?.error).toMatch(/mock/i);
    // No audit event either way in mock mode — nothing was actually tested.
    expect(await testPrisma.auditEvent.count({ where: { module: "ai-integration", action: { in: ["ai_integration.test_connection_succeeded", "ai_integration.test_connection_failed"] } } })).toBe(0);
  });
});

describe("setEmailIntegrationEnabled", () => {
  it("requires manage_email_integration", async () => {
    await userWithPermissions(["view_integrations"]);
    await expect(setEmailIntegrationEnabled(true)).rejects.toThrow();
  });

  it("toggles IntegrationSettings.emailSendingEnabled and audits with the right action name", async () => {
    const user = await userWithPermissions(["manage_email_integration"]);

    await setEmailIntegrationEnabled(true);
    expect((await testPrisma.integrationSettings.findUniqueOrThrow({ where: { id: 1 } })).emailSendingEnabled).toBe(true);
    const enableAudit = await testPrisma.auditEvent.findFirst({ where: { action: "email_integration.enabled" } });
    expect(enableAudit?.actorId).toBe(user.id);

    await setEmailIntegrationEnabled(false);
    expect((await testPrisma.integrationSettings.findUniqueOrThrow({ where: { id: 1 } })).emailSendingEnabled).toBe(false);
    expect(await testPrisma.auditEvent.findFirst({ where: { action: "email_integration.disabled" } })).not.toBeNull();
  });
});

describe("sendTestEmail", () => {
  it("requires send_test_email", async () => {
    await userWithPermissions(["view_integrations"]);
    await expect(sendTestEmail(undefined, testEmailFormData("someone@example.test"))).rejects.toThrow();
  });

  it("rejects an invalid address before ever touching the provider", async () => {
    await userWithPermissions(["send_test_email"]);
    const result = await sendTestEmail(undefined, testEmailFormData("not-an-email"));
    expect(result?.error).toBeTruthy();
    expect(await testPrisma.transactionalEmailMessage.count()).toBe(0);
  });

  it("queues a test email (mock mode) and audits success", async () => {
    const user = await userWithPermissions(["send_test_email"]);
    const result = await sendTestEmail(undefined, testEmailFormData("someone@example.test"));
    expect(result?.error).toBeUndefined();

    const message = await testPrisma.transactionalEmailMessage.findFirstOrThrow({ where: { purpose: "ADMIN_TEST" } });
    expect(message.toAddress).toBe("someone@example.test");
    expect(message.createdById).toBe(user.id);

    const audit = await testPrisma.auditEvent.findFirst({ where: { action: "email_integration.test_email_sent" } });
    expect(audit?.actorId).toBe(user.id);
    expect(audit?.success).toBe(true);
  }, 15000);

  it("is rate-limited to 3 per minute", async () => {
    await userWithPermissions(["send_test_email"]);
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      outcomes.push(await sendTestEmail(undefined, testEmailFormData("someone@example.test")));
    }
    expect(outcomes.some((o) => o?.error?.includes("Too many"))).toBe(true);
  }, 20000);
});

describe("getIntegrationsStatus / getAiUsageRecords — secret safety", () => {
  it("never includes an API key, secret, or connection string anywhere in the returned shape", async () => {
    const status = await getIntegrationsStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toMatch(/sk-|re_test|DATABASE_URL|postgres:\/\//i);

    const usage = await getAiUsageRecords(1, 10);
    expect(JSON.stringify(usage)).not.toMatch(/sk-|re_test|DATABASE_URL|postgres:\/\//i);
  });
});
