import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { capacity, inchToMm, labelOrigin, mmToPt, offsetKeepsLabelsOnPage, pageCount, slotFor, unusedOnLastPage, validateGeometry, type SheetGeometry } from "../../src/lib/mailing-labels/geometry";
import { checkAddress, formatPostalCode, labelLines } from "../../src/lib/mailing-labels/address";
import { chooseAttention, compareCompanies, MANAGER, type ContactOption } from "../../src/lib/mailing-labels/contact";
import { drawCalibrationPdf, drawLabelsPdf, fitLabel, fontMetrics, layoutLabels, type FontMetrics } from "../../src/lib/mailing-labels/render";
import { AVERY_PRESETS, findAveryPreset, gapsFromMargins, PRESET_PAGE } from "../../src/lib/mailing-labels/presets";

// A test geometry: 30 labels (3 x 10) on US Letter. Not a product preset.
const SHEET: SheetGeometry = {
  pageWidthMm: inchToMm(8.5),
  pageHeightMm: inchToMm(11),
  rows: 10,
  columns: 3,
  labelWidthMm: inchToMm(2.625),
  labelHeightMm: inchToMm(1),
  topMm: inchToMm(0.5),
  leftMm: inchToMm(0.1875),
  gapXMm: inchToMm(0.125),
  gapYMm: 0,
  paddingMm: 2,
  preferredFontPt: 9,
  minFontPt: 6,
  lineHeight: 1.1,
};

const ADDRESS = { name: "The Sample Pub", address1: "123 Main Street", city: "Milton", region: "ON", postalCode: "L9T 1A1", country: "Canada" };

function contact(id: string, firstName: string, lastName: string, extra: Partial<ContactOption> = {}): ContactOption {
  return { id, firstName, lastName, doNotContact: false, status: "ACTIVE", ...extra };
}

describe("units and geometry", () => {
  it("converts exactly: 1 in = 25.4 mm = 72 pt", () => {
    expect(inchToMm(1)).toBe(25.4);
    expect(mmToPt(25.4)).toBe(72);
  });

  it("accepts a geometry that fits and rejects one that doesn't", () => {
    expect(validateGeometry(SHEET)).toEqual([]);
    expect(validateGeometry({ ...SHEET, columns: 4 })[0]).toMatch(/don't fit across/);
    expect(validateGeometry({ ...SHEET, rows: 11 })[0]).toMatch(/don't fit down/);
    expect(validateGeometry({ ...SHEET, labelWidthMm: Number.NaN })[0]).toMatch(/must be a number/);
    expect(validateGeometry({ ...SHEET, gapXMm: -1 }).join(" ")).toMatch(/can't be negative/);
    expect(validateGeometry({ ...SHEET, rows: 1000 }).join(" ")).toMatch(/Rows must be a whole number/);
    expect(validateGeometry({ ...SHEET, minFontPt: 12, preferredFontPt: 9 }).join(" ")).toMatch(/minimum font size/);
  });

  it("numbers positions across each row, then down, and skips to the start", () => {
    expect(slotFor(0, 1, SHEET)).toEqual({ page: 0, position: 1, row: 0, column: 0 });
    expect(slotFor(3, 1, SHEET)).toEqual({ page: 0, position: 4, row: 1, column: 0 });
    expect(slotFor(0, 29, SHEET)).toEqual({ page: 0, position: 29, row: 9, column: 1 });
  });

  it("30-position sheet, start 29, 5 labels: two pages, 29-30 then 1-3", () => {
    expect(pageCount(5, 29, 30)).toBe(2);
    expect([0, 1, 2, 3, 4].map((i) => slotFor(i, 29, SHEET)).map((s) => `${s.page}:${s.position}`)).toEqual(["0:29", "0:30", "1:1", "1:2", "1:3"]);
    expect(unusedOnLastPage(5, 29, 30)).toBe(27);
  });

  it("start at the last position with one label is one page", () => {
    expect(pageCount(1, 30, 30)).toBe(1);
    expect(slotFor(0, 30, SHEET)).toMatchObject({ page: 0, position: 30 });
  });

  it("exact capacity is one page and capacity + 1 is two; zero labels is zero pages", () => {
    expect(pageCount(30, 1, 30)).toBe(1);
    expect(unusedOnLastPage(30, 1, 30)).toBe(0);
    expect(pageCount(31, 1, 30)).toBe(2);
    expect(pageCount(0, 1, 30)).toBe(0);
  });

  it("an offset moves the label by exactly that many mm, without resizing", () => {
    const plain = labelOrigin(SHEET, 2, 1);
    const moved = labelOrigin(SHEET, 2, 1, 1.5, -0.75);
    expect(moved.xMm - plain.xMm).toBeCloseTo(1.5, 10);
    expect(moved.yMm - plain.yMm).toBeCloseTo(-0.75, 10);
    expect(offsetKeepsLabelsOnPage(SHEET, 1, 1)).toBe(true);
    expect(offsetKeepsLabelsOnPage(SHEET, 0, -20)).toBe(false);
  });
});

describe("addresses", () => {
  it("formats the confirmed layout: COMPANY, Attn, street, City, RG, postal", () => {
    const check = checkAddress(ADDRESS, "Canada");
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(labelLines("The Sample Pub", "Jane Smith", check)).toEqual([
      { text: "THE SAMPLE PUB", bold: true },
      { text: "Attn: Jane Smith", bold: false },
      { text: "123 Main Street", bold: false },
      { text: "Milton, ON", bold: false },
      { text: "L9T 1A1", bold: false },
    ]);
  });

  it("excludes a missing street, city, province, postal code or country with the exact reason", () => {
    const reasons = (patch: Partial<typeof ADDRESS>) => {
      const check = checkAddress({ ...ADDRESS, ...patch }, "Canada");
      return check.ok ? [] : check.reasons;
    };
    expect(reasons({ address1: " " })).toEqual(["Missing street address"]);
    expect(reasons({ city: "" })).toEqual(["Missing city"]);
    expect(reasons({ region: "" })).toEqual(["Missing province/state"]);
    expect(reasons({ postalCode: null as unknown as string })).toEqual(["Missing postal/ZIP code"]);
    expect(reasons({ country: "" })).toEqual(["Missing country"]);
    expect(reasons({ country: "France" })[0]).toMatch(/isn't supported/);
    expect(reasons({ name: "  " })).toEqual(["Missing company name"]);
  });

  it("formats a Canadian postal code without changing the stored value, and keeps ZIP leading zeros and ZIP+4", () => {
    expect(formatPostalCode("l9t1a1", "Canada")).toBe("L9T 1A1");
    expect(formatPostalCode("02108", "United States")).toBe("02108");
    expect(formatPostalCode("02108 - 1234", "United States")).toBe("02108-1234");
    const raw = { ...ADDRESS, postalCode: "l9t1a1" };
    checkAddress(raw, "Canada");
    expect(raw.postalCode).toBe("l9t1a1");
  });

  it("keeps units, PO boxes, accents, apostrophes and ampersands", () => {
    const check = checkAddress({ ...ADDRESS, name: "Café & Fils", address1: "PO Box 12, Unit 4", city: "Saint-Jérôme", region: "QC", postalCode: "J7Z 1A1" }, "Canada");
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const lines = labelLines("Café & Fils", "Zoë O'Brien", check).map((l) => l.text);
    expect(lines).toEqual(["CAFÉ & FILS", "Attn: Zoë O'Brien", "PO Box 12, Unit 4", "Saint-Jérôme, QC", "J7Z 1A1"]);
  });

  it("adds the country only for mail leaving the sender's country", () => {
    const us = checkAddress({ ...ADDRESS, city: "Boston", region: "MA", postalCode: "02108", country: "USA" }, "Canada");
    expect(us.ok && us.countryLine).toBe("USA");
    const domestic = checkAddress(ADDRESS, "Canada");
    expect(domestic.ok && domestic.countryLine).toBeNull();
  });

  it("flags but doesn't block a postal code that doesn't look right", () => {
    const check = checkAddress({ ...ADDRESS, postalCode: "12345" }, "Canada");
    expect(check.ok).toBe(true);
    expect(check.ok && check.warnings.join()).toMatch(/doesn't look right/);
  });

  it("never uppercases the stored company name", () => {
    const company = { ...ADDRESS };
    const check = checkAddress(company, "Canada");
    if (check.ok) labelLines(company.name, "Manager", check);
    expect(company.name).toBe("The Sample Pub");
  });
});

describe("attention line", () => {
  const jane = contact("c1", "Jane", "Smith");
  it("uses the primary contact", () => {
    expect(chooseAttention("c1", [jane], undefined)).toMatchObject({ name: "Jane Smith", contactId: "c1" });
  });
  it("uses Manager with no primary contact or a blank name, never another contact", () => {
    expect(chooseAttention(null, [jane], undefined)).toMatchObject({ name: "Manager", contactId: null });
    expect(chooseAttention("c2", [contact("c2", " ", "")], undefined).name).toBe("Manager");
  });
  it("prints a partial name cleanly", () => {
    expect(chooseAttention("c3", [contact("c3", "Jane", "")], undefined).name).toBe("Jane");
    expect(chooseAttention("c4", [contact("c4", "", "  Smith ")], undefined).name).toBe("Smith");
  });
  it("skips a primary contact marked do not contact", () => {
    expect(chooseAttention("c1", [{ ...jane, doNotContact: true }], undefined)).toMatchObject({ name: "Manager", note: expect.stringMatching(/do not contact/) });
  });
  it("applies an override for this job: another contact or Manager", () => {
    const bob = contact("c5", "Bob", "Lee");
    expect(chooseAttention("c1", [jane, bob], "c5")).toMatchObject({ name: "Bob Lee", overridden: true });
    expect(chooseAttention("c1", [jane, bob], MANAGER)).toMatchObject({ name: "Manager", overridden: true });
    // A contact that isn't this company's is ignored.
    expect(chooseAttention("c1", [jane], "someone-else")).toMatchObject({ name: "Jane Smith", overridden: false });
  });
});

describe("order", () => {
  it("is alphabetical, case-insensitive, keeps 'The', ignores outer spaces, ties by id", () => {
    const sorted = [
      { name: "zebra bar", id: "1" },
      { name: " Apple Pub", id: "2" },
      { name: "The Anchor", id: "3" },
      { name: "apple pub", id: "0" },
    ].sort(compareCompanies);
    expect(sorted.map((c) => c.id)).toEqual(["0", "2", "3", "1"]);
  });
});

describe("fitting text", () => {
  // Deterministic fake metrics: every character 0.6 em wide.
  const metrics: FontMetrics = { widthOf: (text, size) => text.length * size * 0.6, ascent: 0.8, descent: 0.2 };
  const lines = (company: string) => [
    { text: company, bold: true },
    { text: "Attn: Manager", bold: false },
    { text: "1 Main St", bold: false },
    { text: "Milton, ON", bold: false },
    { text: "L9T 1A1", bold: false },
  ];

  it("fits at the preferred size when it can", () => {
    const result = fitLabel(lines("SHORT PUB"), SHEET, metrics);
    expect(result).toMatchObject({ ok: true, sizePt: SHEET.preferredFontPt });
    expect(result.ok && result.rows.length).toBe(5);
  });

  it("wraps and shrinks a long line without dropping anything", () => {
    const result = fitLabel(lines("THE EXCEPTIONALLY LONG NAMED NEIGHBOURHOOD PUB AND GRILL"), { ...SHEET, labelHeightMm: 40 }, metrics);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.filter((r) => r.line === 0).map((r) => r.text).join(" ")).toBe("THE EXCEPTIONALLY LONG NAMED NEIGHBOURHOOD PUB AND GRILL");
  });

  it("blocks and names the field when even the smallest size won't fit", () => {
    const result = fitLabel(lines("SUPERCALIFRAGILISTICEXPIALIDOCIOUSLYLONGWORDTHATCANNOTBREAK"), SHEET, metrics);
    expect(result).toEqual({ ok: false, field: "company name", problem: expect.stringMatching(/too wide/) });
  });
});

describe("PDF output", () => {
  it("has the sheet's exact page size and count, blank start positions, and embedded fonts", async () => {
    const metrics = await fontMetrics();
    const check = checkAddress(ADDRESS, "Canada");
    if (!check.ok) throw new Error("bad fixture");
    const labels = [0, 1, 2, 3, 4].map((i) => ({ key: String(i), lines: labelLines(`Pub ${i}`, "Manager", check) }));
    const layout = layoutLabels(labels, SHEET, 29, 0, 0, metrics);
    expect(layout.ok).toBe(true);
    if (!layout.ok) return;
    expect(layout.labels.map((l) => `${l.page}:${l.position}`)).toEqual(["0:29", "0:30", "1:1", "1:2", "1:3"]);
    const bytes = await drawLabelsPdf(layout, SHEET, { title: "test", createdAt: new Date("2026-11-06T00:00:00Z") });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeCloseTo(612, 6);
    expect(height).toBeCloseTo(792, 6);
    // Exactly two fonts, regular and bold, each with its font file embedded.
    let fonts = 0;
    let embedded = 0;
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      if (String(obj.get(PDFName.of("Subtype"))) === "/Type0") fonts++;
      if (obj.get(PDFName.of("FontFile2"))) embedded++;
    }
    expect({ fonts, embedded }).toEqual({ fonts: 2, embedded: 2 });
  });

  it("lays out the same way every time (the reprint fingerprint)", async () => {
    const metrics = await fontMetrics();
    const check = checkAddress(ADDRESS, "Canada");
    if (!check.ok) throw new Error("bad fixture");
    const labels = [{ key: "a", lines: labelLines("A", "Manager", check) }];
    const first = layoutLabels(labels, SHEET, 3, 0.5, 0, metrics);
    const second = layoutLabels(labels, SHEET, 3, 0.5, 0, metrics);
    expect(first.ok && second.ok && first.sha256 === second.sha256).toBe(true);
  });

  it("prints markup as plain text", async () => {
    const metrics = await fontMetrics();
    const check = checkAddress({ ...ADDRESS, address1: "<script>alert(1)</script>" }, "Canada");
    if (!check.ok) throw new Error("bad fixture");
    const layout = layoutLabels([{ key: "x", lines: labelLines("Pub", "Manager", check) }], { ...SHEET, labelWidthMm: 66, labelHeightMm: 30 }, 1, 0, 0, metrics);
    expect(layout.ok && layout.labels[0].rows.map((r) => r.text).join(" ")).toContain("<script>alert(1)</script>");
  });

  it("draws a one-page calibration sheet", async () => {
    const pdf = await PDFDocument.load(await drawCalibrationPdf(SHEET, 0, 0, { title: "cal", createdAt: new Date() }));
    expect(pdf.getPageCount()).toBe(1);
    expect(capacity(SHEET)).toBe(30);
  });
});

describe("Avery lookup", () => {
  it("finds a number however it's typed, and not an unknown one", () => {
    expect(findAveryPreset("18163")?.description).toMatch(/2" x 4", 10 per sheet/);
    expect(findAveryPreset(" Avery 5160 ")?.number).toBe("5160");
    expect(findAveryPreset("81863")).toBeNull();
  });

  it("every preset's labels fit on a Letter page", () => {
    for (const p of AVERY_PRESETS) {
      expect(p.columns * inchToMm(p.labelWidthIn)).toBeLessThanOrEqual(PRESET_PAGE.widthMm);
      expect(p.rows * inchToMm(p.labelHeightIn)).toBeLessThanOrEqual(PRESET_PAGE.heightMm);
    }
  });

  it("works out gaps from the two margins, and the result is a valid sheet", () => {
    const p = findAveryPreset("18163")!;
    const gaps = gapsFromMargins(p, inchToMm(0.5), inchToMm(0.15625));
    expect(gaps).not.toBeNull();
    const g = { ...SHEET, rows: p.rows, columns: p.columns, labelWidthMm: inchToMm(p.labelWidthIn), labelHeightMm: inchToMm(p.labelHeightIn), topMm: inchToMm(0.5), leftMm: inchToMm(0.15625), ...gaps! };
    expect(validateGeometry(g)).toEqual([]);
    expect(gaps!.gapYMm).toBeCloseTo(0, 3);
    expect(gapsFromMargins(p, 30, 30)).toBeNull();
  });
});
