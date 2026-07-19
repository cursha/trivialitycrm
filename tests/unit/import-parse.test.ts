import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseSpreadsheet, SpreadsheetParseError } from "../../src/lib/import/parse";

describe("parseSpreadsheet (CSV)", () => {
  it("parses headers and rows from CSV content", async () => {
    const csv = "Business Name,City,Region\nThe Copper Kettle,Milton,ON\nBar B,Oakville,ON\n";
    const result = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "leads.csv");

    expect(result.headers).toEqual(["Business Name", "City", "Region"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]["Business Name"]).toBe("The Copper Kettle");
  });

  it("throws on an empty file", async () => {
    await expect(parseSpreadsheet(Buffer.alloc(0), "empty.csv")).rejects.toThrow(SpreadsheetParseError);
  });

  it("skips blank lines", async () => {
    const csv = "Name,City\nBar A,Milton\n\nBar B,Oakville\n";
    const result = await parseSpreadsheet(Buffer.from(csv, "utf-8"), "leads.csv");
    expect(result.rows).toHaveLength(2);
  });
});

describe("parseSpreadsheet (XLSX)", () => {
  it("parses headers and rows from a real workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Leads");
    sheet.addRow(["Business Name", "City", "Region"]);
    sheet.addRow(["The Copper Kettle", "Milton", "ON"]);
    sheet.addRow(["Bar B", "Oakville", "ON"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseSpreadsheet(buffer, "leads.xlsx");

    expect(result.headers).toEqual(["Business Name", "City", "Region"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]["Business Name"]).toBe("The Copper Kettle");
  });

  it("extracts a formula cell's computed result instead of stringifying the formula object", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Leads");
    sheet.addRow(["Business Name", "Score"]);
    const row = sheet.addRow(["The Copper Kettle", null]);
    row.getCell(2).value = { formula: "1+1", result: 2 } as unknown as ExcelJS.CellValue;
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseSpreadsheet(buffer, "leads.xlsx");

    expect(result.rows[0]["Score"]).toBe("2");
    expect(result.rows[0]["Score"]).not.toContain("object Object");
  });
});

describe("parseSpreadsheet magic-byte validation", () => {
  it("rejects a file claiming .csv whose actual content is a binary XLSX workbook", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Leads").addRow(["Business Name"]);
    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseSpreadsheet(xlsxBuffer, "leads.csv")).rejects.toThrow(SpreadsheetParseError);
  });

  it("rejects a claimed .xlsx whose content is plain text, not a real workbook", async () => {
    const fakeBuffer = Buffer.from("Business Name,City\nBar A,Milton\n", "utf-8");
    await expect(parseSpreadsheet(fakeBuffer, "leads.xlsx")).rejects.toThrow(SpreadsheetParseError);
  });

  it("rejects legacy .xls files outright, regardless of content", async () => {
    const buffer = Buffer.from("Business Name,City\nBar A,Milton\n", "utf-8");
    await expect(parseSpreadsheet(buffer, "leads.xls")).rejects.toThrow(SpreadsheetParseError);
  });

  it("rejects macro-enabled .xlsm files outright, regardless of content", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Leads").addRow(["Business Name"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(parseSpreadsheet(buffer, "leads.xlsm")).rejects.toThrow(SpreadsheetParseError);
  });

  it("rejects a claimed .csv containing a null byte", async () => {
    const buffer = Buffer.from("Business Name,City\nBar\x00A,Milton\n", "binary");
    await expect(parseSpreadsheet(buffer, "leads.csv")).rejects.toThrow(SpreadsheetParseError);
  });
});
