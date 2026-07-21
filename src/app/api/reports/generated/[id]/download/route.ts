import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { buildReportCsv, buildReportXlsx } from "@/lib/reports/export";
import { REPORT_LABELS, type ReportKey } from "@/lib/reports/build-rows";
import type { ExportColumn } from "@/lib/export/serialize";

type StoredPayload = { columns: ExportColumn[]; rows: Record<string, string>[] };

function formatPeriod(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "short", day: "numeric" });
  // periodEnd is an exclusive boundary — display the last included instant, not the boundary itself.
  const inclusiveEnd = new Date(end.getTime() - 1000);
  return `${fmt.format(start)} to ${fmt.format(inclusiveEnd)} (America/Toronto)`;
}

/**
 * Serves a previously-generated report exactly as it was frozen at
 * generation time (GeneratedReport.payload) — never a live re-query. A
 * scheduled report's recipient, the schedule's creator, or an
 * administrator with manage_scheduled_reports may download it; anyone else
 * gets 403. Opening this link also marks the report seen for this viewer.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const generated = await prisma.generatedReport.findUnique({
    where: { id },
    include: { scheduledReport: { select: { createdById: true, name: true, createdBy: { select: { email: true } } } } },
  });
  if (!generated) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const isRecipient = generated.recipientIds.includes(user.id);
  const isCreator = generated.scheduledReport?.createdById === user.id;
  const isManager = hasPermission(user, "manage_scheduled_reports");
  if (!isRecipient && !isCreator && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (generated.status !== "SUCCEEDED") {
    return NextResponse.json({ error: "This report run did not succeed — nothing to download." }, { status: 409 });
  }

  if (!generated.seenByIds.includes(user.id)) {
    await prisma.generatedReport.update({ where: { id }, data: { seenByIds: { push: user.id } } });
  }

  const payload = generated.payload as unknown as StoredPayload;
  const meta = {
    reportName: generated.scheduledReport?.name ?? REPORT_LABELS[generated.reportKey as ReportKey] ?? generated.reportKey,
    dateRangeLabel: formatPeriod(generated.periodStart, generated.periodEnd),
    filtersLabel: "See the scheduled report's saved view, if any.",
    generatedAt: generated.createdAt,
    generatedByEmail: generated.scheduledReport?.createdBy.email ?? "system (schedule deleted)",
  };

  if (format === "xlsx") {
    const buffer = await buildReportXlsx(meta, payload.columns, payload.rows);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${generated.reportKey}-${id}.xlsx"`,
      },
    });
  }

  const csv = buildReportCsv(meta, payload.columns, payload.rows);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${generated.reportKey}-${id}.csv"` },
  });
}
