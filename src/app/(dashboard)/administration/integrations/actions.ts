"use server";

import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { writeAuditEvent } from "@/lib/audit/log";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { classifyProviderError } from "@/lib/integrations/provider-errors";
import { sendSystemEmail } from "@/lib/transactional/send-system-email";
import { validateEmailAddress } from "@/lib/comms/validate";
import Anthropic from "@anthropic-ai/sdk";

export type ActionResult = { error?: string; message?: string } | undefined;

const PATH = "/administration/integrations";

// --- AI integration ---------------------------------------------------

export async function setAiIntegrationEnabled(enabled: boolean): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_ai_integration");

  const before = await prisma.aiSettings.findUnique({ where: { id: 1 } });
  await prisma.aiSettings.upsert({
    where: { id: 1 },
    update: { researchEnabled: enabled, updatedById: user.id },
    create: { id: 1, researchEnabled: enabled, updatedById: user.id },
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "ai-integration",
    action: enabled ? "ai_integration.enabled" : "ai_integration.disabled",
    entityType: "AiSettings",
    entityId: "1",
    beforeData: before ?? undefined,
    metadata: { researchEnabled: enabled },
  });

  revalidatePath(PATH);
  revalidatePath("/administration");
  revalidatePath("/administration/ai-settings");
  return undefined;
}

/**
 * Makes one minimal real Anthropic API call (max_tokens: 16, no tools, no
 * research content) to confirm the configured key authenticates and the
 * model is reachable — never run automatically, only on explicit admin
 * click. A no-op with a clear message in mock mode, since there's no live
 * provider to test.
 */
export async function testAiConnection(): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_ai_integration");

  const env = getEnv();
  if (env.AI_PROVIDER !== "anthropic") {
    return { error: "Not applicable — AI_PROVIDER is set to mock, not anthropic." };
  }

  const rateLimit = await checkRateLimit(`test-ai-connection:${user.id}`, { windowMs: 60_000, limit: 3 });
  if (!rateLimit.allowed) {
    return { error: "Too many connection tests — wait a moment and try again." };
  }

  const correlationId = crypto.randomUUID();
  try {
    const settings = await prisma.aiSettings.findUnique({ where: { id: 1 } });
    const model = settings?.approvedModel ?? "claude-sonnet-5";
    const client = new Anthropic({ apiKey: env.AI_API_KEY, maxRetries: 0 });
    await client.messages.create({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with OK." }] });

    await writeAuditEvent({
      actorId: user.id,
      module: "ai-integration",
      action: "ai_integration.test_connection_succeeded",
      correlationId,
      metadata: { model },
    });
    revalidatePath(PATH);
    return { message: "Connection test succeeded." };
  } catch (error) {
    const classified = classifyProviderError(error);
    await writeAuditEvent({
      actorId: user.id,
      module: "ai-integration",
      action: "ai_integration.test_connection_failed",
      success: false,
      correlationId,
      metadata: { category: classified.category },
    });
    revalidatePath(PATH);
    return { error: classified.safeMessage };
  }
}

// --- Email integration --------------------------------------------------

export async function setEmailIntegrationEnabled(enabled: boolean): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "manage_email_integration");

  const before = await prisma.integrationSettings.findUnique({ where: { id: 1 } });
  await prisma.integrationSettings.upsert({
    where: { id: 1 },
    update: { emailSendingEnabled: enabled, updatedById: user.id },
    create: { id: 1, emailSendingEnabled: enabled, updatedById: user.id },
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "email-integration",
    action: enabled ? "email_integration.enabled" : "email_integration.disabled",
    entityType: "IntegrationSettings",
    entityId: "1",
    beforeData: before ?? undefined,
    metadata: { emailSendingEnabled: enabled },
  });

  revalidatePath(PATH);
  revalidatePath("/administration");
  return undefined;
}

export async function sendTestEmail(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  requirePermission(user, "send_test_email");

  const toAddress = String(formData.get("toAddress") ?? "").trim();
  const addressCheck = validateEmailAddress(toAddress);
  if (!addressCheck.valid) return { error: addressCheck.reason };

  const rateLimit = await checkRateLimit(`test-email-send:${user.id}`, { windowMs: 60_000, limit: 3 });
  if (!rateLimit.allowed) {
    return { error: "Too many test emails sent recently — wait a moment and try again." };
  }

  const outcome = await sendSystemEmail({
    purpose: "ADMIN_TEST",
    toAddress,
    subject: "Triviality CRM — test email",
    bodyText: `This is a controlled test email sent from the Integrations page by ${user.name} to confirm the transactional email provider is working.`,
    idempotencyKey: `admin-test:${crypto.randomUUID()}`,
    createdById: user.id,
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "email-integration",
    action: outcome.ok ? "email_integration.test_email_sent" : "email_integration.test_email_failed",
    success: outcome.ok,
    entityType: "TransactionalEmailMessage",
    entityId: outcome.ok ? outcome.id : undefined,
    metadata: { toAddress },
  });

  if (!outcome.ok) return { error: outcome.error };

  revalidatePath(PATH);
  return { message: "Test email queued — check its status below in a few seconds." };
}
