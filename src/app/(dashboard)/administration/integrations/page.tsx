import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getIntegrationsStatus, getAiUsageRecords } from "./queries";
import { AiControls } from "./ai-controls";
import { EmailIntegrationToggle, TestEmailForm } from "./email-controls";

export const metadata = { title: "Integrations — Triviality CRM" };

function StatusBadge({ ok, trueLabel, falseLabel }: { ok: boolean; trueLabel: string; falseLabel: string }) {
  return <Badge tone={ok ? "success" : "danger"}>{ok ? trueLabel : falseLabel}</Badge>;
}

export default async function IntegrationsPage() {
  const user = await requireUser();
  requirePermission(user, "view_integrations");

  const canViewUsage = hasPermission(user, "view_provider_usage");
  const [status, usage] = await Promise.all([getIntegrationsStatus(), canViewUsage ? getAiUsageRecords(1, 20) : Promise.resolve(null)]);

  const canManageAi = hasPermission(user, "manage_ai_integration");
  const canManageEmail = hasPermission(user, "manage_email_integration");
  const canSendTestEmail = hasPermission(user, "send_test_email");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Integrations"
        description="Live AI research and transactional email — provider status, budget/usage, and safe controlled actions. Never shows API keys, secrets, connection strings, or raw payloads."
      />

      <div>
        <SectionHeading>AI research</SectionHeading>
        <Card className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.ai.providerMode === "mock" ? "neutral" : "focus"}>{status.ai.providerMode === "mock" ? "Mock — test data only" : "Anthropic — live"}</Badge>
            <StatusBadge ok={status.ai.apiKeyConfigured} trueLabel="Key configured" falseLabel="Key not configured" />
            <Badge tone="secondary">{status.ai.approvedModel}</Badge>
            <StatusBadge ok={status.ai.researchEnabled} trueLabel="Research enabled" falseLabel="Research disabled" />
          </div>
          <p className="mt-2 text-sm text-text-muted">
            Today: ${status.ai.todaySpendUsd.toFixed(2)}
            {status.ai.dailyBudgetUsd !== null ? ` / $${status.ai.dailyBudgetUsd.toFixed(2)}` : ""} · This month: ${status.ai.monthSpendUsd.toFixed(2)}
            {status.ai.monthlyBudgetUsd !== null ? ` / $${status.ai.monthlyBudgetUsd.toFixed(2)}` : ""}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Last successful request: {status.ai.lastSuccessfulRequestAt ? new Date(status.ai.lastSuccessfulRequestAt).toLocaleString() : "Never"}
            {status.ai.queue && ` · Queue: ${status.ai.queue.active} active, ${status.ai.queue.retry} retrying, ${status.ai.queue.failed} failed`}
          </p>

          <AiControls researchEnabled={status.ai.researchEnabled} canManage={canManageAi} />

          {status.ai.recentFailures.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase text-text-muted">Recent failures</p>
              <ul className="mt-1 space-y-1">
                {status.ai.recentFailures.map((f) => (
                  <li key={f.id} className="text-xs text-text-muted">
                    {f.occurredAt ? new Date(f.occurredAt).toLocaleString() : "—"} — {f.message ?? "No message recorded."}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionHeading>Transactional email</SectionHeading>
        <Card className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.email.provider === "mock" ? "neutral" : "focus"}>{status.email.provider === "mock" ? "Mock — test data only" : "Resend — live"}</Badge>
            <StatusBadge ok={status.email.configured} trueLabel="Configured" falseLabel="Not configured" />
            <StatusBadge ok={status.email.sendingEnabled} trueLabel="Sending enabled" falseLabel="Sending disabled" />
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Last successful send: {status.email.lastSuccessfulSendAt ? new Date(status.email.lastSuccessfulSendAt).toLocaleString() : "Never"} · Suppressed addresses: {status.email.suppressionCount}
            {status.email.queue && ` · Queue: ${status.email.queue.active} active, ${status.email.queue.retry} retrying, ${status.email.queue.failed} failed`}
          </p>

          <EmailIntegrationToggle sendingEnabled={status.email.sendingEnabled} canManage={canManageEmail} />
          <TestEmailForm canSend={canSendTestEmail} />

          {status.email.recentFailures.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase text-text-muted">Recent failures</p>
              <ul className="mt-1 space-y-1">
                {status.email.recentFailures.map((f) => (
                  <li key={f.id} className="text-xs text-text-muted">
                    {new Date(f.occurredAt).toLocaleString()} — {f.purpose} — {f.message ?? "No message recorded."} {f.category ? `(${f.category})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {canViewUsage && usage && (
        <div>
          <SectionHeading>AI provider usage</SectionHeading>
          <Card className="mt-3 overflow-x-auto p-0">
            {usage.rows.length === 0 ? (
              <div className="p-5">
                <EmptyState>No AI provider usage recorded yet.</EmptyState>
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="bg-black/5 text-xs uppercase text-text-muted">
                  <tr>
                    <th className="px-4 py-2">When</th>
                    <th className="px-4 py-2">User</th>
                    <th className="px-4 py-2">Operation</th>
                    <th className="px-4 py-2">Model</th>
                    <th className="px-4 py-2">Tokens (in/out)</th>
                    <th className="px-4 py-2">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.rows.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-4 py-2 text-text-muted">{row.createdAt.toLocaleString()}</td>
                      <td className="px-4 py-2">{row.userName ?? "—"}</td>
                      <td className="px-4 py-2">{row.operation}</td>
                      <td className="px-4 py-2">{row.model}</td>
                      <td className="px-4 py-2">
                        {row.inputTokens} / {row.outputTokens}
                      </td>
                      <td className="px-4 py-2 font-semibold text-text">${row.estimatedCostUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-4 py-2 text-xs text-text-muted">Showing the most recent {usage.rows.length} of {usage.total} recorded calls.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
