import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase, testPrisma } from "../helpers/db";
import { resetEnvCacheForTests } from "../../src/lib/env";
import { sendSystemEmail, processQueuedSystemEmail } from "../../src/lib/transactional/send-system-email";
import { SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS } from "../../src/lib/transactional/providers/mock";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalEmailProvider = process.env.EMAIL_PROVIDER;

beforeEach(async () => {
  await resetDatabase();
  mutableEnv.EMAIL_PROVIDER = "mock";
  resetEnvCacheForTests();
});

afterEach(() => {
  if (originalEmailProvider === undefined) delete mutableEnv.EMAIL_PROVIDER;
  else mutableEnv.EMAIL_PROVIDER = originalEmailProvider;
  delete mutableEnv.RESEND_API_KEY;
  delete mutableEnv.RESEND_FROM_ADDRESS;
  delete mutableEnv.RESEND_WEBHOOK_SECRET;
  resetEnvCacheForTests();
});

describe("sendSystemEmail", () => {
  it("queues, then a simulated worker pass sends via the mock provider and marks SENT", async () => {
    const outcome = await sendSystemEmail({
      purpose: "ADMIN_TEST",
      toAddress: "admin@example.test",
      subject: "Test",
      bodyText: "Hello",
      idempotencyKey: "test-1",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const queued = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(queued.status).toBe("QUEUED");

    await processQueuedSystemEmail(outcome.id);

    const sent = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.providerMessageId).toMatch(/^mock-transactional:/);
    expect(sent.sentAt).not.toBeNull();
  }, 15000);

  it("mock mode is exempt from the emailSendingEnabled check (stays off by default)", async () => {
    const settings = await testPrisma.integrationSettings.findUnique({ where: { id: 1 } });
    expect(settings?.emailSendingEnabled ?? false).toBe(false);

    const outcome = await sendSystemEmail({
      purpose: "ADMIN_TEST",
      toAddress: "admin@example.test",
      subject: "Test",
      bodyText: "Hello",
      idempotencyKey: "test-2",
    });
    expect(outcome.ok).toBe(true);
  }, 15000);

  it("refuses when EMAIL_PROVIDER=resend and emailSendingEnabled is still false", async () => {
    mutableEnv.EMAIL_PROVIDER = "resend";
    mutableEnv.RESEND_API_KEY = "re_test_key";
    mutableEnv.RESEND_FROM_ADDRESS = "noreply@example.test";
    mutableEnv.RESEND_WEBHOOK_SECRET = "whsec_test";
    resetEnvCacheForTests();

    const outcome = await sendSystemEmail({
      purpose: "ADMIN_TEST",
      toAddress: "admin@example.test",
      subject: "Test",
      bodyText: "Hello",
      idempotencyKey: "test-3",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/disabled/i);
    expect(await testPrisma.transactionalEmailMessage.count()).toBe(0);
  });

  it("sends once emailSendingEnabled is explicitly turned on", async () => {
    mutableEnv.EMAIL_PROVIDER = "resend";
    mutableEnv.RESEND_API_KEY = "re_test_key";
    mutableEnv.RESEND_FROM_ADDRESS = "noreply@example.test";
    mutableEnv.RESEND_WEBHOOK_SECRET = "whsec_test";
    resetEnvCacheForTests();
    await testPrisma.integrationSettings.upsert({ where: { id: 1 }, update: { emailSendingEnabled: true }, create: { id: 1, emailSendingEnabled: true } });

    const outcome = await sendSystemEmail({
      purpose: "ADMIN_TEST",
      toAddress: "admin@example.test",
      subject: "Test",
      bodyText: "Hello",
      idempotencyKey: "test-4",
    });
    // NODE_ENV=test always forces the mock provider regardless of
    // EMAIL_PROVIDER (see factory.ts) — this proves the *gate*, not a real
    // Resend call.
    expect(outcome.ok).toBe(true);
  }, 15000);

  it("refuses a suppressed address and never creates a message row", async () => {
    await testPrisma.emailSuppression.create({ data: { address: "bounced@example.test", reason: "hard_bounce", source: "test" } });

    const outcome = await sendSystemEmail({
      purpose: "ADMIN_TEST",
      toAddress: "bounced@example.test",
      subject: "Test",
      bodyText: "Hello",
      idempotencyKey: "test-5",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/suppression/i);
    expect(await testPrisma.transactionalEmailMessage.count()).toBe(0);
  });

  it("is idempotent — the same idempotencyKey twice returns the same message, never a duplicate", async () => {
    const first = await sendSystemEmail({
      purpose: "ADMIN_TEST",
      toAddress: "admin@example.test",
      subject: "Test",
      bodyText: "Hello",
      idempotencyKey: "same-key",
    });
    const second = await sendSystemEmail({
      purpose: "ADMIN_TEST",
      toAddress: "admin@example.test",
      subject: "Test",
      bodyText: "Hello",
      idempotencyKey: "same-key",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.id).toBe(first.id);
    expect(await testPrisma.transactionalEmailMessage.count()).toBe(1);
  }, 15000);

  it("marks FAILED with a safe error and failure category on a provider send failure", async () => {
    const outcome = await sendSystemEmail({
      purpose: "ADMIN_TEST",
      toAddress: SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS,
      subject: "Test",
      bodyText: "Hello",
      idempotencyKey: "test-6",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    await processQueuedSystemEmail(outcome.id);

    const failed = await testPrisma.transactionalEmailMessage.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureCategory).toBeTruthy();
    expect(failed.errorMessage).toBeTruthy();
  }, 15000);

  it("is rate-limited", async () => {
    const outcomes = [];
    for (let i = 0; i < 31; i++) {
      outcomes.push(
        await sendSystemEmail({
          purpose: "ADMIN_TEST",
          toAddress: "admin@example.test",
          subject: "Test",
          bodyText: "Hello",
          idempotencyKey: `rate-limit-${i}`,
        }),
      );
    }
    expect(outcomes.some((o) => !o.ok && o.error.includes("Too many"))).toBe(true);
  }, 30000);
});
