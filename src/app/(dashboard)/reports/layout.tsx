import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { reportScope } from "@/lib/reports/scope";
import { PageHeader } from "@/components/ui/page-header";
import { ReportTabs, type ReportTab } from "./report-tabs";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const scope = reportScope(user);

  if (!scope) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Reports" />
        <p className="mt-2 text-text-muted">
          Your account doesn&apos;t have a report-viewing permission yet — ask an Administrator to grant one.
        </p>
      </div>
    );
  }

  const tabs: ReportTab[] = [
    { href: "/reports", label: "Dashboard" },
    { href: "/reports/pipeline", label: "Pipeline" },
    { href: "/reports/salespeople", label: "Salespeople" },
    { href: "/reports/sources", label: "Lead Sources" },
    { href: "/reports/ai-research", label: "AI Research" },
  ];
  if (hasPermission(user, "view_competitor_reports")) {
    tabs.push({ href: "/reports/competitors", label: "Competitors" });
  }
  tabs.push(
    { href: "/reports/territories", label: "Territories" },
    { href: "/reports/lead-types", label: "Lead Types" },
    { href: "/reports/trends", label: "Trends" },
  );
  // Scheduled reports (worker + CRUD UI) deferred to Module Six per explicit
  // scope decision — see MODULE_5_REPORT.md's "Known limitations" section.
  // The manage_scheduled_reports permission still exists (seeded, assignable)
  // so it's ready to gate that future UI without another migration.

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Reports" description="Accurate, real-data reporting on leads, pipeline, and performance." />
      <ReportTabs tabs={tabs} />
      {children}
    </div>
  );
}
