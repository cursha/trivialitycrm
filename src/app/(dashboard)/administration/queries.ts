import "server-only";
import { prisma } from "@/lib/prisma";
import { getQueueSummary } from "@/lib/jobs/observability";
import { getAiSettings, getCurrentAiSpend, isAiApiKeyConfigured, classifyAiBudgetStatus } from "@/lib/ai/budget";
import { getEnv } from "@/lib/env";
import { describeAuditEvent } from "@/lib/audit/describe";
import { getIntegrationSettings } from "@/lib/integrations/settings";
import { isTransactionalEmailConfigured } from "@/lib/transactional/factory";

export async function getAdministrationSummary() {
  const [activeUsers, inactiveUsers, roleCount, recentAuditEvents, queueSummary] = await Promise.all([
    prisma.user.count({ where: { disabled: false } }),
    prisma.user.count({ where: { disabled: true } }),
    prisma.role.count({ where: { active: true } }),
    prisma.auditEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 5, include: { actor: { select: { name: true } } } }),
    getQueueSummary(),
  ]);

  const failedJobs = queueSummary.reduce((sum, q) => sum + q.failed, 0);
  const retryingJobs = queueSummary.reduce((sum, q) => sum + q.retry, 0);

  const env = getEnv();
  const aiSettings = await getAiSettings();
  const spend = await getCurrentAiSpend();
  const integrationSettings = await getIntegrationSettings();

  const budgetStatus = classifyAiBudgetStatus(aiSettings, spend);

  return {
    activeUsers,
    inactiveUsers,
    roleCount,
    recentAuditEvents: recentAuditEvents.map((event) => ({
      id: event.id,
      description: describeAuditEvent(event),
      actorName: event.actor?.name ?? "System",
      occurredAt: event.occurredAt,
    })),
    failedJobs,
    retryingJobs,
    aiProviderMode: env.AI_PROVIDER,
    aiApiKeyConfigured: isAiApiKeyConfigured(),
    aiResearchEnabled: aiSettings.researchEnabled,
    budgetStatus,
    todaySpendUsd: spend.todayUsd,
    monthSpendUsd: spend.monthUsd,
    emailProviderMode: env.EMAIL_PROVIDER,
    emailConfigured: isTransactionalEmailConfigured(),
    emailSendingEnabled: integrationSettings.emailSendingEnabled,
  };
}
