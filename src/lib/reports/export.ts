import "server-only";
import ExcelJS from "exceljs";
import { buildCsv, type ExportColumn } from "@/lib/export/serialize";
import { neutralizeForExport } from "@/lib/security/formula-injection";

export type ReportExportMeta = {
  reportName: string;
  dateRangeLabel: string;
  filtersLabel: string;
  generatedAt: Date;
  generatedByEmail: string;
};

/**
 * Every report export must carry its own name, date range, filters, and
 * generation timestamp (per the brief) — src/lib/export/serialize.ts's
 * buildCsv/buildXlsx have no concept of that, and are left untouched (still
 * reused exactly as-is for the row/column serialization and formula-
 * injection neutralization) rather than bolting report-specific metadata
 * onto a shared utility every other export also uses.
 */
function metadataLines(meta: ReportExportMeta): string[] {
  return [
    `Report: ${meta.reportName}`,
    `Date range: ${meta.dateRangeLabel}`,
    `Filters: ${meta.filtersLabel || "None"}`,
    `Generated: ${meta.generatedAt.toISOString()} by ${meta.generatedByEmail}`,
    "",
  ];
}

export function buildReportCsv(meta: ReportExportMeta, columns: ExportColumn[], rows: Record<string, string>[]): string {
  return `${metadataLines(meta).join("\n")}\n${buildCsv(columns, rows)}`;
}

export async function buildReportXlsx(meta: ReportExportMeta, columns: ExportColumn[], rows: Record<string, string>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");
  for (const line of metadataLines(meta)) {
    if (line) sheet.addRow([line]);
    else sheet.addRow([]);
  }
  sheet.addRow(columns.map((column) => column.label));
  for (const row of rows) {
    sheet.addRow(columns.map((column) => neutralizeForExport(row[column.key] ?? "")));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
