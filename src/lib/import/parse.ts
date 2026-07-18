import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";

export type ParsedSpreadsheet = {
  headers: string[];
  rows: Record<string, string>[];
};

const MAX_ROWS = 5000;

export class SpreadsheetParseError extends Error {}

function isCsv(filename: string): boolean {
  return filename.toLowerCase().endsWith(".csv");
}

function parseCsv(buffer: Buffer): ParsedSpreadsheet {
  const text = buffer.toString("utf-8");
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new SpreadsheetParseError(result.errors[0].message);
  }
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data.slice(0, MAX_ROWS) };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSpreadsheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new SpreadsheetParseError("The workbook has no worksheets.");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(String(cell.value ?? "").trim());
  });

  const rows: Record<string, string>[] = [];
  for (let rowNumber = 2; rowNumber <= Math.min(sheet.rowCount, MAX_ROWS + 1); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      const cell = row.getCell(index + 1);
      record[header] = cell.value == null ? "" : String(cell.value).trim();
    });
    if (Object.values(record).some((value) => value !== "")) rows.push(record);
  }

  return { headers, rows };
}

/** Parses an uploaded spreadsheet entirely in memory — the caller (uploadSpreadsheet
 * action) never writes the buffer or the parsed rows to disk or Postgres. */
export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedSpreadsheet> {
  if (buffer.byteLength === 0) throw new SpreadsheetParseError("The uploaded file is empty.");
  return isCsv(filename) ? parseCsv(buffer) : parseXlsx(buffer);
}
