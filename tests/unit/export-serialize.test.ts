import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildCsv, buildXlsx } from "../../src/lib/export/serialize";

const columns = [
  { key: "name", label: "Name" },
  { key: "city", label: "City" },
];

describe("buildCsv", () => {
  it("writes a header row and one row per record", () => {
    const csv = buildCsv(columns, [{ name: "The Copper Kettle", city: "Milton" }]);
    expect(csv).toBe("Name,City\nThe Copper Kettle,Milton\n");
  });

  it("escapes commas, quotes, and newlines", () => {
    const csv = buildCsv(columns, [{ name: 'The "Copper" Kettle, Ltd', city: "Line1\nLine2" }]);
    expect(csv).toContain('"The ""Copper"" Kettle, Ltd"');
    expect(csv).toContain('"Line1\nLine2"');
  });

  it("writes just the header when there are no rows", () => {
    expect(buildCsv(columns, [])).toBe("Name,City\n");
  });
});

describe("buildXlsx", () => {
  it("produces a readable workbook with the expected header and rows", async () => {
    const buffer = await buildXlsx(columns, [{ name: "The Copper Kettle", city: "Milton" }]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];

    expect(sheet.getRow(1).getCell(1).value).toBe("Name");
    expect(sheet.getRow(2).getCell(1).value).toBe("The Copper Kettle");
  });
});
