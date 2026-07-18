import Link from "next/link";
import { BarChart3, Building2, CalendarClock, ListTree, Trophy, Users } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { getDashboardStats } from "./queries";

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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-blue-500" />
        <h3 className="font-bold">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{item.label}</span>
                <b>{item.count}</b>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${(item.count / total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const stats = await getDashboardStats(user);

  if (!stats) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-black tracking-tight">Welcome, {user.name}</h1>
        <p className="mt-2 text-slate-500">
          Your account doesn&apos;t have a lead-viewing permission yet — ask an Administrator to grant one.
        </p>
      </div>
    );
  }

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
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-3xl font-black tracking-tight">Welcome, {user.name}</h2>
          <p className="mt-1 text-slate-500">Here&apos;s what&apos;s happening across your leads.</p>
        </div>
        <Link
          href="/companies"
          className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-200"
        >
          View companies
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statTiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">{tile.label}</p>
            <div className="mt-2 flex items-end justify-between">
              <strong className="text-3xl">{tile.value}</strong>
              <BarChart3 className={tile.alert && tile.value > 0 ? "text-red-400" : "text-blue-400"} />
            </div>
          </div>
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
