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
});
