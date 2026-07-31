import Link from "next/link";
import { BarChart3, Building2, CalendarClock, ListTree, Trophy, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { getAiSettings, getCurrentAiSpend, classifyAiBudgetStatus } from "@/lib/ai/budget";
import { getDashboardStats } from "./queries";
import { getMyPriorityList, getMyPipelineCounts } from "./priority-data";
import { PriorityList } from "./priority-list";
import { Card, SectionHeading } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { AI_BUDGET_STATUS_TONE, AI_BUDGET_STATUS_LABEL, toneFor } from "@/lib/ui/status-tones";
import clsx from "clsx";

export const metadata = { title: "Dashboard — Triviality CRM" };

const GRADE_LABELS: Record<string, string> = { A_PLUS: "A+", A: "A", B: "B", C: "C", D: "D" };
const CLASSIFICATION_LABELS: Record<string, string> = {
  ENTERTAINMENT_READY: "Entertainment-Ready",
  GREENFIELD: "Greenfield",
  REPLACEMENT: "Replacement",
  NEEDS_QUALIFICATION: "Needs Qualification",
  EXISTING_CUSTOMER: "Existing Customer",
};

function BreakdownList({
  title,
  icon: Icon,
  items,
  emptyLabel,
}: {
  title: string;
  icon: typeof Users;
  items: { label: string; count: number }[];
  emptyLabel: string;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-secondary" />
        <h3 className="font-bold text-accent">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{emptyLabel}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-text">{item.label}</span>
                <b className="text-text">{item.count}</b>
              </div>
              <div className="h-1.5 rounded-full bg-border/40">
                <div className="h-1.5 rounded-full bg-secondary" style={{ width: `${(item.count / total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const stats = await getDashboardStats(user);

  if (!stats) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-black tracking-tight text-accent">Welcome, {user.name}</h1>
        <p className="mt-2 text-text-muted">
          Your account doesn&apos;t have a lead-viewing permission yet — ask an Administrator to grant one.
        </p>
      </div>
    );
  }

  const workspaceSettings = await prisma.workspaceSettings.findUnique({ where: { id: 1 } });
  const thresholds = {
    noActivityThresholdDays: workspaceSettings?.noActivityThresholdDays ?? 14,
    newlyAssignedThresholdDays: workspaceSettings?.newlyAssignedThresholdDays ?? 3,
  };
  const canViewAiUsage = hasPermission(user, "view_administration");
  const [priorityItems, myPipelineCounts, aiUsage] = await Promise.all([
    getMyPriorityList(user, thresholds),
    getMyPipelineCounts(user),
    canViewAiUsage
      ? Promise.all([getAiSettings(), getCurrentAiSpend()]).then(([settings, spend]) => ({
          spend,
          status: classifyAiBudgetStatus(settings, spend),
        }))
      : Promise.resolve(null),
  ]);

  const statTiles = [
    { label: "Active leads", value: stats.activeLeads },
    { label: "Follow-ups due today", value: stats.followUpsDueToday },
    { label: "Overdue follow-ups", value: stats.followUpsOverdue, alert: true },
    { label: "Demos", value: stats.demos },
    { label: "Trials", value: stats.trials },
    { label: "Booked", value: stats.booked },
    { label: "Won", value: stats.won },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-7">
      <PageHeader
        title={`Welcome, ${user.name}`}
        description="Here's what's happening across your leads."
        actions={
          <Link
            href="/companies"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-hover"
          >
            View companies
          </Link>
        }
      />

      {aiUsage && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SectionHeading>AI usage</SectionHeading>
            <Badge tone={toneFor(AI_BUDGET_STATUS_TONE, aiUsage.status)}>{AI_BUDGET_STATUS_LABEL[aiUsage.status]}</Badge>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span>
              <span className="text-text-muted">Today: </span>
              <strong className="text-text">${aiUsage.spend.todayUsd.toFixed(2)}</strong>
            </span>
            <span>
              <span className="text-text-muted">This month: </span>
              <strong className="text-text">${aiUsage.spend.monthUsd.toFixed(2)}</strong>
            </span>
            <Link href="/administration/ai-settings" className="text-secondary hover:underline">
              Manage →
            </Link>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <SectionHeading>What should I do next?</SectionHeading>
          <div className="mt-3">
            <PriorityList items={priorityItems} />
          </div>
        </Card>
        <Card>
          <SectionHeading>My pipeline</SectionHeading>
          {myPipelineCounts.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">No leads assigned to you yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {myPipelineCounts.map((row) => (
                <div key={row.stageName} className="flex items-center justify-between text-sm">
                  <span className="text-text">{row.stageName}</span>
                  <span className="font-semibold text-text">{row.count}</span>
                </div>
              ))}
            </div>
          )}
          <Link href="/pipeline?view=saved" className="mt-4 inline-block text-sm font-semibold text-secondary hover:underline">
            Quick links to saved views →
          </Link>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statTiles.map((tile) => (
          <Card key={tile.label}>
            <p className="text-sm font-semibold text-text-muted">{tile.label}</p>
            <div className="mt-2 flex items-end justify-between">
              <strong className="text-3xl text-text">{tile.value}</strong>
              <BarChart3 className={clsx(tile.alert && tile.value > 0 ? "text-primary" : "text-secondary")} />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <BreakdownList
          title="Pipeline"
          icon={Building2}
          items={stats.pipelineBreakdown.map((s) => ({ label: s.stageName, count: s.count }))}
          emptyLabel="No active companies yet."
        />
        <BreakdownList
          title="Lead Types"
          icon={ListTree}
          items={stats.leadTypeBreakdown.map((t) => ({ label: t.leadTypeName, count: t.count }))}
          emptyLabel="No active companies yet."
        />
        <BreakdownList
          title="Salespeople"
          icon={Users}
          items={stats.salespeopleBreakdown.map((s) => ({ label: s.userName, count: s.count }))}
          emptyLabel="No active companies yet."
        />
        <BreakdownList
          title="Competitors"
          icon={Trophy}
          items={stats.competitorsBreakdown.map((c) => ({ label: c.competitorName, count: c.count }))}
          emptyLabel="No companies linked to a competitor."
        />
        <BreakdownList
          title="EOS Grades"
          icon={CalendarClock}
          items={stats.eosGradeBreakdown.map((g) => ({ label: GRADE_LABELS[g.grade] ?? g.grade, count: g.count }))}
          emptyLabel="No companies scored yet."
        />
        <BreakdownList
          title="Primary Classifications"
          icon={Building2}
          items={stats.classificationBreakdown.map((c) => ({
            label: CLASSIFICATION_LABELS[c.classification] ?? c.classification,
            count: c.count,
          }))}
          emptyLabel="No companies scored yet."
        />
      </div>
    </div>
  );
}
