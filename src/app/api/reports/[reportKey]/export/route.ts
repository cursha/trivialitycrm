import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { parseReportFilters, type ReportFilters } from "@/lib/reports/filters";
import { buildReportCsv, buildReportXlsx } from "@/lib/reports/export";
import { buildReportRows, REPORT_KEYS, REPORT_LABELS, type ReportKey } from "@/lib/reports/build-rows";

const DATE_RANGE_LABELS: Record<string, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
};

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

  const result = await buildReportRows(key, user, filters);
  if (result.forbidden) {
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
    const buffer = await buildReportXlsx(meta, result.columns, result.rows);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${key}-report.xlsx"`,
      },
    });
  }

  const csv = buildReportCsv(meta, result.columns, result.rows);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${key}-report.csv"` },
  });
}
