import "server-only";
import ExcelJS from "exceljs";
import { neutralizeForExport } from "@/lib/security/formula-injection";

export type ExportColumn = { key: string; label: string };

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Pure — no I/O — so it's unit-tested directly. Every cell value is passed through
 * neutralizeForExport first (OWASP CSV/formula-injection guidance) — row data here
 * ultimately originates from user input (manual entry, AI research, or a spreadsheet
 * import), so a value like "=HYPERLINK(...)" must never reach Excel/Sheets as a live
 * formula just because someone opens an exported file. Column labels are static,
 * app-defined strings, never user input, so they're left as-is. */
export function buildCsv(columns: ExportColumn[], rows: Record<string, string>[]): string {
  const header = columns.map((column) => csvEscape(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(neutralizeForExport(row[column.key] ?? ""))).join(",")).join("\n");
  return body.length > 0 ? `${header}\n${body}\n` : `${header}\n`;
}

export async function buildXlsx(columns: ExportColumn[], rows: Record<string, string>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Export");
  sheet.addRow(columns.map((column) => column.label));
  for (const row of rows) {
    sheet.addRow(columns.map((column) => neutralizeForExport(row[column.key] ?? "")));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
