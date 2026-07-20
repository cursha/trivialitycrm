import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { parseReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { buildReportCsv, buildReportXlsx } from "@/lib/reports/export";
import type { ExportColumn } from "@/lib/export/serialize";
import type { RateResult } from "@/lib/reports/metrics";
import { getDashboardMetrics } from "@/app/(dashboard)/reports/queries";
import { getPipelineReport } from "@/app/(dashboard)/reports/pipeline/queries";
import { getSalespeopleReport } from "@/app/(dashboard)/reports/salespeople/queries";
import { getSourcesReport } from "@/app/(dashboard)/reports/sources/queries";
import { getAiResearchReport } from "@/app/(dashboard)/reports/ai-research/queries";
import { getCompetitorsReport } from "@/app/(dashboard)/reports/competitors/queries";
import { getTerritoriesReport } from "@/app/(dashboard)/reports/territories/queries";
import { getLeadTypesReport } from "@/app/(dashboard)/reports/lead-types/queries";
import { getTrendsReport } from "@/app/(dashboard)/reports/trends/queries";

const REPORT_KEYS = [
  "dashboard",
  "pipeline",
  "salespeople",
  "sources",
  "ai-research",
  "competitors",
  "territories",
  "lead-types",
  "trends",
] as const;
type ReportKey = (typeof REPORT_KEYS)[number];

const REPORT_LABELS: Record<ReportKey, string> = {
  dashboard: "Reporting Dashboard",
  pipeline: "Pipeline Report",
  salespeople: "Salesperson Report",
  sources: "Lead Source Report",
  "ai-research": "AI Research Report",
  competitors: "Competitor Report",
  territories: "Territory Report",
  "lead-types": "Lead Type Report",
  trends: "Trends Report",
};

const DATE_RANGE_LABELS: Record<string, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
};

function rateLabel(result: RateResult): string {
  if (result.suppressed) return `Not enough data (${result.numerator}/${result.denominator})`;
  return `${(result.rate * 100).toFixed(0)}% (${result.numerator}/${result.denominator})`;
}

function dateRangeLabel(filters: ReportFilters): string {
  if (filters.dateRange === "custom") {
    return `${filters.customFrom ?? "?"} to ${filters.customTo ?? "?"} (America/Toronto)`;
  }
  return DATE_RANGE_LABELS[filters.dateRange] ?? filters.dateRange;
}

function filtersLabel(filters: ReportFilters): string {
  const entries = Object.entries(filters).filter(
    ([key, value]) => value !== undefined && key !== "dateRange" && key !== "customFrom" && key !== "customTo",
  );
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export async function GET(request: Request, { params }: { params: Promise<{ reportKey: string }> }) {
  const user = await requireUser();
  requirePermission(user, "export_reports");

  const { reportKey } = await params;
  if (!REPORT_KEYS.includes(reportKey as ReportKey)) {
    return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  }
  const key = reportKey as ReportKey;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const rawFilters: Record<string, string | undefined> = {};
  for (const [k, v] of searchParams.entries()) rawFilters[k] = v;
  const filters = parseReportFilters(rawFilters);

  let columns: ExportColumn[] = [];
  let rows: Record<string, string>[] = [];
  let forbidden = false;

  switch (key) {
    case "dashboard": {
      const workspaceSettings = await prisma.workspaceSettings.findUnique({ where: { id: 1 } });
      const metrics = await getDashboardMetrics(user, filters, workspaceSettings?.noActivityThresholdDays ?? 14);
      if (!metrics) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value" },
      ];
      rows = [
        { metric: "New leads", value: String(metrics.newLeads) },
        { metric: "Manual leads", value: String(metrics.manualLeads) },
        { metric: "AI-transferred leads", value: String(metrics.aiLeads) },
        { metric: "Imported leads", value: String(metrics.importedLeads) },
        { metric: "Active leads", value: String(metrics.activeLeads) },
        { metric: "Unassigned leads", value: String(metrics.unassignedLeads) },
        { metric: "Archived (in range)", value: String(metrics.archivedInRange) },
        { metric: "Overdue follow-ups", value: String(metrics.overdueFollowUps) },
        { metric: "Follow-ups created", value: String(metrics.followUpsCreated) },
        { metric: "Activities completed", value: String(metrics.activitiesCompleted) },
        { metric: "No recent activity", value: String(metrics.noRecentActivity) },
        { metric: "Active trials", value: String(metrics.activeTrials) },
        { metric: "Won (in range)", value: String(metrics.wonInRange) },
        { metric: "Lost (in range)", value: String(metrics.lostInRange) },
        { metric: "Competitor-linked leads", value: String(metrics.competitorLinked) },
        { metric: "AI searches run", value: String(metrics.aiSearchesRun) },
        { metric: "AI candidates discovered", value: String(metrics.aiCandidatesDiscovered) },
        ...metrics.pipelineBreakdown.map((s) => ({ metric: `Pipeline: ${s.stageName}`, value: String(s.count) })),
      ];
      break;
    }
    case "pipeline": {
      const workspaceSettings = await prisma.workspaceSettings.findUnique({ where: { id: 1 } });
      const report = await getPipelineReport(user, filters, workspaceSettings?.noActivityThresholdDays ?? 14);
      if (!report) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "section", label: "Section" },
        { key: "label", label: "Label" },
        { key: "value", label: "Value" },
      ];
      rows = [
        ...report.currentPipelineBreakdown.map((s) => ({ section: "Current pipeline", label: s.stageName, value: String(s.count) })),
        ...report.entriesByStage.map((s) => ({ section: "Entries (in range)", label: s.stageName, value: String(s.count) })),
        ...report.exitsByStage.map((s) => ({ section: "Exits (in range)", label: s.stageName, value: String(s.count) })),
        ...report.avgDaysByStage.map((s) => ({ section: "Avg days in stage", label: s.stageName, value: String(s.avgDays) })),
        { section: "Stalled leads", label: "Stalled", value: String(report.stalledCount) },
        { section: "Stalled leads", label: "Not tracked", value: String(report.stalledUntracked) },
        ...report.lossReasonBreakdown.map((r) => ({ section: "Loss reasons", label: r.label, value: String(r.count) })),
        ...report.stageConversions.map((c) => ({ section: "Stage conversion", label: `${c.from} -> ${c.to}`, value: rateLabel(c.result) })),
        { section: "New -> Won", label: "Cohort rate", value: rateLabel(report.newToWonRate) },
        ...report.winRateByLeadType.map((r) => ({ section: "Win rate by lead type", label: r.label, value: rateLabel(r.result) })),
        ...report.winRateBySource.map((r) => ({ section: "Win rate by source", label: r.label, value: rateLabel(r.result) })),
        ...report.winRateBySalesperson.map((r) => ({ section: "Win rate by salesperson", label: r.label, value: rateLabel(r.result) })),
      ];
      break;
    }
    case "salespeople": {
      const report = await getSalespeopleReport(user, filters);
      if (!report) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "name", label: "Salesperson" },
        { key: "activitiesCompleted", label: "Activity Completed" },
        { key: "pipelineProgress", label: "Pipeline Progress" },
        { key: "won", label: "Won" },
        { key: "lost", label: "Lost" },
        { key: "currentWorkload", label: "Current Workload" },
      ];
      rows = report.rows.map((r) => ({
        name: r.name,
        activitiesCompleted: String(r.activitiesCompleted),
        pipelineProgress: String(r.pipelineProgress),
        won: String(r.won),
        lost: String(r.lost),
        currentWorkload: String(r.currentWorkload),
      }));
      break;
    }
    case "sources": {
      const report = await getSourcesReport(user, filters);
      if (!report) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "label", label: "Source" },
        { key: "count", label: "Count" },
      ];
      rows = [
        ...report.rows.map((r) => ({ label: r.label, count: String(r.count) })),
        ...report.winRateBySource.map((r) => ({ label: `Win rate: ${r.label}`, count: rateLabel(r.result) })),
      ];
      break;
    }
    case "ai-research": {
      const report = await getAiResearchReport(user, filters);
      if (!report) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "section", label: "Section" },
        { key: "value", label: "Value" },
      ];
      rows = [
        { section: "Searches run", value: String(report.searchesRun) },
        ...report.funnel.map((f) => ({ section: f.label, value: String(f.count) })),
        ...report.searchStatusBreakdown.map((s) => ({ section: `Search status: ${s.label}`, value: String(s.count) })),
        ...report.dispositionBreakdown.map((d) => ({ section: `Result: ${d.label}`, value: String(d.count) })),
        ...(report.costEstimate
          ? [
              { section: "Estimated AI cost (USD, not a bill)", value: report.costEstimate.totalUsd.toFixed(2) },
              { section: "Total tokens", value: String(report.costEstimate.totalTokens) },
              { section: "Provider calls", value: String(report.costEstimate.callCount) },
            ]
          : [{ section: "Estimated AI cost", value: "Not permitted to view" }]),
      ];
      break;
    }
    case "competitors": {
      const report = await getCompetitorsReport(user, filters);
      if (!report || report.forbidden) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "name", label: "Competitor" },
        { key: "linkedLeads", label: "Linked Active Leads" },
        { key: "wonInRange", label: "Won (in range)" },
        { key: "lostInRange", label: "Lost (in range)" },
      ];
      rows = report.rows.map((r) => ({
        name: r.name,
        linkedLeads: String(r.linkedLeads),
        wonInRange: String(r.wonInRange),
        lostInRange: String(r.lostInRange),
      }));
      break;
    }
    case "territories": {
      const report = await getTerritoriesReport(user, filters);
      if (!report) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "name", label: "Territory" },
        { key: "leadCount", label: "Active Leads" },
        { key: "wonInRange", label: "Won (in range)" },
        { key: "lostInRange", label: "Lost (in range)" },
      ];
      rows = report.rows.map((r) => ({
        name: r.name,
        leadCount: r.leadCount === 0 ? "No recorded leads" : String(r.leadCount),
        wonInRange: String(r.wonInRange),
        lostInRange: String(r.lostInRange),
      }));
      if (report.unmatched > 0) rows.push({ name: "(not yet researched into any territory)", leadCount: String(report.unmatched), wonInRange: "", lostInRange: "" });
      break;
    }
    case "lead-types": {
      const report = await getLeadTypesReport(user, filters);
      if (!report) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "label", label: "Lead Type" },
        { key: "count", label: "Active Leads" },
      ];
      rows = [
        ...report.rows.map((r) => ({ label: r.label, count: String(r.count) })),
        ...report.winRateByLeadType.map((r) => ({ label: `Win rate: ${r.label}`, count: rateLabel(r.result) })),
      ];
      break;
    }
    case "trends": {
      const report = await getTrendsReport(user, filters);
      if (!report) {
        forbidden = true;
        break;
      }
      columns = [
        { key: "weekOf", label: "Week Of" },
        { key: "newLeads", label: "New Leads" },
        { key: "won", label: "Won" },
        { key: "lost", label: "Lost" },
        { key: "activities", label: "Activities" },
      ];
      rows = report.rows.map((r) => ({
        weekOf: r.weekStart.toISOString().slice(0, 10),
        newLeads: String(r.newLeads),
        won: String(r.won),
        lost: String(r.lost),
        activities: String(r.activities),
      }));
      break;
    }
  }

  if (forbidden) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const meta = {
    reportName: REPORT_LABELS[key],
    dateRangeLabel: dateRangeLabel(filters),
    filtersLabel: filtersLabel(filters),
    generatedAt: new Date(),
    generatedByEmail: user.email,
  };

  if (format === "xlsx") {
    const buffer = await buildReportXlsx(meta, columns, rows);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${key}-report.xlsx"`,
      },
    });
  }

  const csv = buildReportCsv(meta, columns, rows);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${key}-report.csv"` },
  });
}
