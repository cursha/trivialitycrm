import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { fileTypeFromBuffer } from "file-type";

export type ParsedSpreadsheet = {
  headers: string[];
  rows: Record<string, string>[];
};

const MAX_ROWS = 5000;
const MAX_COLUMNS = 100;
const PARSE_TIMEOUT_MS = 15_000;

export class SpreadsheetParseError extends Error {}

type SpreadsheetKind = "csv" | "xlsx";

function detectClaimedKind(filename: string): SpreadsheetKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  throw new SpreadsheetParseError('Only .csv and .xlsx files are supported (not .xls, .xlsm, or other formats).');
}

/**
 * Magic-byte validation, independent of the filename extension a browser
 * happily lets a user lie about. A genuine .xlsx is a zip container —
 * file-type's dedicated Office-format detector reports it as "xlsx"
 * specifically (not just "zip"), so anything else (a renamed .xls/OLE2
 * file, a renamed .exe, a zip that isn't actually an xlsx workbook) is
 * rejected. A genuine CSV has no reliable magic bytes at all — file-type
 * returns undefined for real text content — so a *defined* detection result
 * for a file claiming to be .csv means it's binary content mislabeled as
 * text, which is rejected too. A raw null byte anywhere in a claimed-CSV
 * buffer is the same signal via a cheaper check.
 */
async function assertContentMatchesClaim(buffer: Buffer, claimed: SpreadsheetKind): Promise<void> {
  const detected = await fileTypeFromBuffer(buffer);

  if (claimed === "xlsx") {
    if (!detected || detected.ext !== "xlsx") {
      throw new SpreadsheetParseError("This file's content doesn't look like a genuine .xlsx workbook.");
    }
    return;
  }

  // claimed === "csv"
  if (detected) {
    throw new SpreadsheetParseError("This file's content doesn't look like plain-text CSV.");
  }
  if (buffer.includes(0)) {
    throw new SpreadsheetParseError("This file's content doesn't look like plain-text CSV.");
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SpreadsheetParseError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function parseCsv(buffer: Buffer): ParsedSpreadsheet {
  const text = buffer.toString("utf-8");
  const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new SpreadsheetParseError(result.errors[0].message);
  }
  const headers = (result.meta.fields ?? []).slice(0, MAX_COLUMNS);
  if ((result.meta.fields?.length ?? 0) > MAX_COLUMNS) {
    throw new SpreadsheetParseError(`Too many columns (max ${MAX_COLUMNS}).`);
  }
  return { headers, rows: result.data.slice(0, MAX_ROWS) };
}

/** Extracts a usable string from an ExcelJS cell value, including formula
 * cells — a formula cell's `.value` is an object ({formula, result, ...}),
 * not a primitive, so naively `String()`-ing it degrades to the literal
 * string "[object Object]" instead of the cell's actual computed content. */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("result" in value && value.result != null) return String(value.result);
    if ("text" in value && value.text != null) return String(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((fragment) => fragment.text).join("");
    }
    return "";
  }
  return String(value).trim();
}

async function parseXlsxBuffer(buffer: Buffer): Promise<ParsedSpreadsheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new SpreadsheetParseError("The workbook has no worksheets.");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    headers.push(cellText(cell.value));
  });
  if (headers.length > MAX_COLUMNS) {
    throw new SpreadsheetParseError(`Too many columns (max ${MAX_COLUMNS}).`);
  }

  const rows: Record<string, string>[] = [];
  for (let rowNumber = 2; rowNumber <= Math.min(sheet.rowCount, MAX_ROWS + 1); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      const cell = row.getCell(index + 1);
      record[header] = cellText(cell.value).trim();
    });
    if (Object.values(record).some((value) => value !== "")) rows.push(record);
  }

  return { headers, rows };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSpreadsheet> {
  return withTimeout(parseXlsxBuffer(buffer), PARSE_TIMEOUT_MS, "This workbook took too long to parse — it may be corrupted or unusually large.");
}

/** Parses an uploaded spreadsheet entirely in memory — the caller (uploadSpreadsheet
 * action) never writes the buffer or the parsed rows to disk; only the caller decides
 * whether/how the parsed result is later persisted (see src/lib/import/batch-store.ts). */
export async function parseSpreadsheet(buffer: Buffer, filename: string): Promise<ParsedSpreadsheet> {
  if (buffer.byteLength === 0) throw new SpreadsheetParseError("The uploaded file is empty.");

  const claimed = detectClaimedKind(filename);
  await assertContentMatchesClaim(buffer, claimed);

  return claimed === "csv" ? parseCsv(buffer) : parseXlsx(buffer);
}
