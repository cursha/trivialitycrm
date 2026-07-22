import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { toneFor, AI_BUDGET_STATUS_TONE, AI_BUDGET_STATUS_LABEL } from "@/lib/ui/status-tones";
import { getAdministrationSummary } from "./queries";

export const metadata = { title: "Administration — Triviality CRM" };

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border-strong bg-surface-raised p-4 shadow-sm">
      <p className="text-3xl font-black text-accent">{value}</p>
      <p className="mt-1 text-sm font-semibold text-text-muted">{label}</p>
    </div>
  );
}

export default async function AdministrationPage() {
  const user = await requireUser();
  requirePermission(user, "view_administration");

  const summary = await getAdministrationSummary();

  const sections = [
    { href: "/administration/organization", label: "Organization Settings", description: "Organization name, locale defaults, and business contact info.", permission: "manage_organization_settings" },
    { href: "/settings/users", label: "Users", description: "Create accounts, assign roles, unlock accounts, and transfer ownership.", permission: "manage_users" },
    { href: "/settings/roles", label: "Roles and Permissions", description: "Grouped permissions, effective-permissions preview, and role duplication.", permission: "manage_roles" },
    { href: "/administration/ai-settings", label: "AI Settings", description: "Provider mode, approved model, and budget controls.", permission: "manage_ai_settings" },
    { href: "/administration/audit-log", label: "Audit Log", description: "A redacted, read-only record of administrative actions.", permission: "view_audit_log" },
    { href: "/administration/system-health", label: "System Health", description: "Web, database, worker, and queue status.", permission: "view_system_health" },
  ].filter((section) => hasPermission(user, section.permission));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Administration" description="Version 1 essentials for running this CRM safely — organization settings, user safety, AI budget controls, an audit trail, and system health." />

      <div>
        <SectionHeading>Overview</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <StatCard label="Active users" value={summary.activeUsers} />
          <StatCard label="Inactive users" value={summary.inactiveUsers} />
          <StatCard label="Roles" value={summary.roleCount} />
          <StatCard label="Failed jobs" value={summary.failedJobs} />
          <StatCard label="Retrying jobs" value={summary.retryingJobs} />
        </div>
      </div>

      <div>
        <SectionHeading>AI research</SectionHeading>
        <Card className="mt-3 flex flex-wrap items-center gap-3">
          <Badge tone={summary.aiProviderMode === "mock" ? "neutral" : "focus"}>{summary.aiProviderMode === "mock" ? "Mock — test data only" : "Anthropic — live"}</Badge>
          <Badge tone={summary.aiApiKeyConfigured ? "success" : "warning"}>{summary.aiApiKeyConfigured ? "API key configured" : "API key not configured"}</Badge>
          <Badge tone={summary.aiResearchEnabled ? "success" : "danger"}>{summary.aiResearchEnabled ? "Research enabled" : "Research disabled"}</Badge>
          <Badge tone={toneFor(AI_BUDGET_STATUS_TONE, summary.budgetStatus)}>{AI_BUDGET_STATUS_LABEL[summary.budgetStatus]}</Badge>
          <span className="text-xs text-text-muted">
            Today: ${summary.todaySpendUsd.toFixed(2)} · This month: ${summary.monthSpendUsd.toFixed(2)}
          </span>
        </Card>
      </div>

      <div>
        <SectionHeading>Recent administrative changes</SectionHeading>
        <Card className="mt-3 space-y-2">
          {summary.recentAuditEvents.length === 0 ? (
            <EmptyState>No administrative changes recorded yet.</EmptyState>
          ) : (
            summary.recentAuditEvents.map((event) => (
              <p key={event.id} className="text-sm text-text">
                <span className="text-text-muted">{event.occurredAt.toLocaleString()} — </span>
                {event.description}
                <span className="text-text-muted"> ({event.actorName})</span>
              </p>
            ))
          )}
        </Card>
      </div>

      {sections.length === 0 ? (
        <Card>
          <EmptyState>You don&apos;t have access to any administration sections.</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sections.map((section) => (
            <Link key={section.href} href={section.href} className="rounded-2xl border border-border-strong bg-surface-raised p-5 shadow-sm hover:border-focus hover:shadow-md">
              <b className="text-text">{section.label}</b>
              <p className="mt-1 text-sm text-text-muted">{section.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
