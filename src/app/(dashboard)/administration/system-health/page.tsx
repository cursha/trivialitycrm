import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getSystemHealth } from "./queries";
import { JobActions } from "./job-actions";

export const metadata = { title: "System Health — Triviality CRM" };

const CLEANUP_QUEUES = ["cleanup-sessions", "cleanup-import-batches", "cleanup-rate-limit-buckets"];

function StatusBadge({ ok, trueLabel, falseLabel }: { ok: boolean; trueLabel: string; falseLabel: string }) {
  return <Badge tone={ok ? "success" : "danger"}>{ok ? trueLabel : falseLabel}</Badge>;
}

export default async function SystemHealthPage() {
  const user = await requireUser();
  requirePermission(user, "view_system_health");

  const health = await getSystemHealth();
  const canManageJobs = hasPermission(user, "manage_background_jobs");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="System Health" description="Read-only status for the web app, database, worker, and background jobs. Never shows secrets, environment values, raw payloads, or stack traces." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <Card>
          <p className="text-xs font-semibold uppercase text-text-muted">Web application</p>
          <div className="mt-1">
            <StatusBadge ok trueLabel="Running" falseLabel="Down" />
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase text-text-muted">Database</p>
          <div className="mt-1">
            <StatusBadge ok={health.databaseStatus === "up"} trueLabel="Connected" falseLabel="Unreachable" />
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase text-text-muted">Worker</p>
          <div className="mt-1">
            <Badge tone={health.workerStatus === "healthy" ? "success" : health.workerStatus === "stale" ? "danger" : "neutral"}>
              {health.workerStatus === "healthy" ? "Healthy" : health.workerStatus === "stale" ? "Not running" : "No data yet"}
            </Badge>
          </div>
          {health.lastHeartbeatAt && <p className="mt-1 text-xs text-text-muted">Last heartbeat: {new Date(health.lastHeartbeatAt).toLocaleString()}</p>}
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase text-text-muted">Migrations</p>
          <div className="mt-1">
            {health.migrationsClean === null ? <Badge tone="neutral">Unknown</Badge> : <StatusBadge ok={health.migrationsClean} trueLabel="Applied cleanly" falseLabel="Incomplete migration found" />}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase text-text-muted">App version</p>
          <p className="mt-1 text-sm font-semibold text-text">{health.appVersion}{health.buildId ? ` (${health.buildId})` : ""}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase text-text-muted">AI provider</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={health.aiProviderMode === "mock" ? "neutral" : "focus"}>{health.aiProviderMode}</Badge>
            <StatusBadge ok={health.aiApiKeyConfigured} trueLabel="Key configured" falseLabel="Key not configured" />
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase text-text-muted">Email provider</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={health.microsoftConfigured ? "success" : "neutral"}>Microsoft {health.microsoftConfigured ? "configured" : "not configured"}</Badge>
            <Badge tone={health.googleConfigured ? "success" : "neutral"}>Google {health.googleConfigured ? "configured" : "not configured"}</Badge>
          </div>
          <p className="mt-1 text-xs text-text-muted">{health.connectedMailboxCount} mailbox(es) connected</p>
        </Card>
      </div>

      <div>
        <SectionHeading>Queues</SectionHeading>
        <Card className="mt-3 overflow-x-auto p-0">
          {health.queueSummary.length === 0 ? (
            <div className="p-5">
              <EmptyState>No job data yet — the worker may not have run against this database.</EmptyState>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-black/5 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-4 py-2">Queue</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2">Retry</th>
                  <th className="px-4 py-2">Active</th>
                  <th className="px-4 py-2">Completed</th>
                  <th className="px-4 py-2">Cancelled</th>
                  <th className="px-4 py-2">Failed</th>
                  <th className="px-4 py-2">Cleanup tick?</th>
                </tr>
              </thead>
              <tbody>
                {health.queueSummary.map((q) => (
                  <tr key={q.queue} className="border-t border-border">
                    <td className="px-4 py-2 font-medium text-text">{q.queue}</td>
                    <td className="px-4 py-2">{q.created}</td>
                    <td className="px-4 py-2">{q.retry}</td>
                    <td className="px-4 py-2">{q.active}</td>
                    <td className="px-4 py-2">{q.completed}</td>
                    <td className="px-4 py-2">{q.cancelled}</td>
                    <td className="px-4 py-2">{q.failed > 0 ? <Badge tone="danger">{q.failed}</Badge> : q.failed}</td>
                    <td className="px-4 py-2 text-text-muted">{CLEANUP_QUEUES.includes(q.queue) ? "Yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div>
        <SectionHeading>Failed jobs</SectionHeading>
        <Card className="mt-3 overflow-hidden p-0">
          {health.failedJobs.length === 0 ? (
            <div className="p-5">
              <EmptyState>No failed jobs.</EmptyState>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {health.failedJobs.map((job) => (
                <div key={job.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-text">{job.queue}</p>
                    <p className="text-xs text-text-muted">{job.errorMessage ?? "No error message recorded."}</p>
                    <p className="text-xs text-text-muted">
                      Retries: {job.retryCount}/{job.retryLimit} · {job.completedOn ? new Date(job.completedOn).toLocaleString() : "—"}
                    </p>
                  </div>
                  <JobActions queue={job.queue} jobId={job.id} canManage={canManageJobs} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
