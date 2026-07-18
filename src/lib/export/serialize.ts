import "server-only";
import ExcelJS from "exceljs";

export type ExportColumn = { key: string; label: string };

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Pure — no I/O — so it's unit-tested directly. */
export function buildCsv(columns: ExportColumn[], rows: Record<string, string>[]): string {
  const header = columns.map((column) => csvEscape(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvEscape(row[column.key] ?? "")).join(",")).join("\n");
  return body.length > 0 ? `${header}\n${body}\n` : `${header}\n`;
}

export async function buildXlsx(columns: ExportColumn[], rows: Record<string, string>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Export");
  sheet.addRow(columns.map((column) => column.label));
  for (const row of rows) {
    sheet.addRow(columns.map((column) => row[column.key] ?? ""));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
