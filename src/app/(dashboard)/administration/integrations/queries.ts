import "server-only";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { getAiSettings, getCurrentAiSpend, isAiApiKeyConfigured } from "@/lib/ai/budget";
import { getIntegrationSettings } from "@/lib/integrations/settings";
import { isTransactionalEmailConfigured } from "@/lib/transactional/factory";
import { getQueueSummary } from "@/lib/jobs/observability";

const AI_QUEUE_NAME = "run-search";
const EMAIL_QUEUE_NAME = "send-system-email";

export async function getIntegrationsStatus() {
  const env = getEnv();

  const [aiSettings, spend, lastAiUsage, recentAiFailures, queueSummary, integrationSettings, lastEmailSent, recentEmailFailures, suppressionCount] =
    await Promise.all([
      getAiSettings(),
      getCurrentAiSpend(),
      prisma.aiUsageRecord.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.leadSearch.findMany({
        where: { status: "FAILED" },
        orderBy: { completedAt: "desc" },
        take: 5,
        select: { id: true, errorMessage: true, completedAt: true },
      }),
      getQueueSummary(),
      getIntegrationSettings(),
      prisma.transactionalEmailMessage.findFirst({
        where: { status: { in: ["SENT", "DELIVERED"] } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
      prisma.transactionalEmailMessage.findMany({
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, purpose: true, errorMessage: true, failureCategory: true, createdAt: true },
      }),
      prisma.emailSuppression.count(),
    ]);

  const aiQueue = queueSummary.find((q) => q.queue === AI_QUEUE_NAME) ?? null;
  const emailQueue = queueSummary.find((q) => q.queue === EMAIL_QUEUE_NAME) ?? null;

  return {
    ai: {
      providerMode: env.AI_PROVIDER,
      apiKeyConfigured: isAiApiKeyConfigured(),
      approvedModel: aiSettings.approvedModel,
      researchEnabled: aiSettings.researchEnabled,
      lastSuccessfulRequestAt: lastAiUsage?.createdAt ?? null,
      recentFailures: recentAiFailures.map((row) => ({ id: row.id, message: row.errorMessage, occurredAt: row.completedAt })),
      todaySpendUsd: spend.todayUsd,
      monthSpendUsd: spend.monthUsd,
      dailyBudgetUsd: aiSettings.dailyBudgetUsd,
      monthlyBudgetUsd: aiSettings.monthlyBudgetUsd,
      queue: aiQueue,
    },
    email: {
      provider: env.EMAIL_PROVIDER,
      sendingEnabled: integrationSettings.emailSendingEnabled,
      configured: isTransactionalEmailConfigured(),
      lastSuccessfulSendAt: lastEmailSent?.sentAt ?? null,
      recentFailures: recentEmailFailures.map((row) => ({
        id: row.id,
        purpose: row.purpose,
        message: row.errorMessage,
        category: row.failureCategory,
        occurredAt: row.createdAt,
      })),
      suppressionCount,
      queue: emailQueue,
    },
  };
}

export type IntegrationsStatus = Awaited<ReturnType<typeof getIntegrationsStatus>>;

/** Paginated AiUsageRecord browsing for view_provider_usage — kept separate
 * from getIntegrationsStatus() so the summary page load never pays for a
 * potentially large scan; only fetched when the usage table is actually
 * requested. */
export async function getAiUsageRecords(page: number, pageSize: number) {
  const [total, rows] = await Promise.all([
    prisma.aiUsageRecord.count(),
    prisma.aiUsageRecord.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { name: true } } },
    }),
  ]);

  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      model: row.model,
      operation: row.operation,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      estimatedCostUsd: Number(row.estimatedCostUsd),
      userName: row.user?.name ?? null,
      searchId: row.searchId,
      createdAt: row.createdAt,
    })),
  };
}
