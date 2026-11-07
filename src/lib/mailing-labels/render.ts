// Label layout and PDF drawing. One pipeline for preview, generation and
// reprints: layoutLabels() decides every line, size and position; drawPdf()
// only draws what the layout says. Vector text in an embedded font at exact
// physical positions; nothing is clipped, shortened or dropped — a label
// that can't fit at the minimum size blocks the whole job instead.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { LabelLine } from "./address";
import { capacity, labelOrigin, mmToPt, pageCount, slotFor, type SheetGeometry } from "./geometry";

/** Bumped whenever layout rules or the font change, and stored on each batch. */
export const LAYOUT_VERSION = "labels-1 / DejaVu Sans 2.37";

/** Shrink step when a label doesn't fit at the preferred size. */
const SIZE_STEP_PT = 0.5;

/** The logical field each label line holds, for overflow messages. */
const FIELD_NAMES = ["company name", "Attn line", "street", "city and province/state", "postal/ZIP code", "country"];

/** Font metrics the fitter needs, so it can be tested without a PDF. */
export type FontMetrics = {
  widthOf(text: string, sizePt: number, bold: boolean): number;
  /** Height above the baseline (ascent) and below it (descent), per point of size. */
  ascent: number;
  descent: number;
};

export type PlacedRow = { text: string; bold: boolean; line: number };
export type FittedLabel = { ok: true; sizePt: number; rows: PlacedRow[] } | { ok: false; field: string; problem: string };

/** Split one logical line into rows no wider than `width`, breaking at spaces.
 * Null when a single word is wider than the label at this size. */
function wrap(text: string, bold: boolean, sizePt: number, width: number, metrics: FontMetrics): string[] | null {
  const words = text.split(" ").filter(Boolean);
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    if (metrics.widthOf(word, sizePt, bold) > width) return null;
    const candidate = current ? `${current} ${word}` : word;
    if (metrics.widthOf(candidate, sizePt, bold) <= width) current = candidate;
    else {
      rows.push(current);
      current = word;
    }
  }
  if (current) rows.push(current);
  return rows;
}

/** Height of `n` rows of text at this size, ascent of the first to descent of the last. */
function blockHeight(n: number, sizePt: number, lineHeight: number, metrics: FontMetrics): number {
  return n === 0 ? 0 : metrics.ascent * sizePt + (n - 1) * sizePt * lineHeight + metrics.descent * sizePt;
}

/**
 * Fit a label's lines into its inner area: the preferred size first,
 * wrapping long lines at spaces, then shrinking in half-point steps down to
 * the minimum. Lines keep their order; nothing is cut. Reports which field
 * defeated it when even the minimum size won't fit.
 */
export function fitLabel(lines: LabelLine[], g: SheetGeometry, metrics: FontMetrics): FittedLabel {
  const width = mmToPt(g.labelWidthMm - 2 * g.paddingMm);
  const height = mmToPt(g.labelHeightMm - 2 * g.paddingMm);
  let lastFailure: { field: string; problem: string } = { field: "label", problem: "doesn't fit" };

  for (let size = g.preferredFontPt; size >= g.minFontPt - 1e-9; size = Math.round((size - SIZE_STEP_PT) * 100) / 100) {
    const rows: PlacedRow[] = [];
    let wordTooWide: number | null = null;
    lines.forEach((line, index) => {
      if (wordTooWide !== null) return;
      const wrapped = wrap(line.text, line.bold, size, width, metrics);
      if (wrapped === null) wordTooWide = index;
      else for (const text of wrapped) rows.push({ text, bold: line.bold, line: index });
    });
    if (wordTooWide !== null) {
      lastFailure = { field: FIELD_NAMES[wordTooWide] ?? "a line", problem: "has a word too wide for the label" };
      continue;
    }
    if (blockHeight(rows.length, size, g.lineHeight, metrics) <= height + 1e-6) return { ok: true, sizePt: size, rows };
    // Name the field that wrapped onto the most extra rows: the likeliest fix.
    const extra = lines.map((_, index) => rows.filter((row) => row.line === index).length - 1);
    const worst = extra.indexOf(Math.max(...extra));
    lastFailure = {
      field: Math.max(...extra) > 0 ? (FIELD_NAMES[worst] ?? "a line") : "label",
      problem: Math.max(...extra) > 0 ? "is too long to fit, even wrapped at the smallest size" : "has more lines than the label is tall",
    };
  }
  return { ok: false, ...lastFailure };
}

export type LabelInput = { lines: LabelLine[]; key: string };
export type PlacedLabel = { key: string; page: number; position: number; xMm: number; yMm: number; sizePt: number; rows: PlacedRow[] };
export type Layout =
  | { ok: true; pages: number; labels: PlacedLabel[]; sha256: string }
  | { ok: false; overflows: { key: string; field: string; problem: string }[] };

/** Place every label (in the order given) from `start` on the first sheet. */
export function layoutLabels(labels: LabelInput[], g: SheetGeometry, start: number, offsetXMm: number, offsetYMm: number, metrics: FontMetrics): Layout {
  const overflows: { key: string; field: string; problem: string }[] = [];
  const placed: PlacedLabel[] = [];
  labels.forEach((label, index) => {
    const fitted = fitLabel(label.lines, g, metrics);
    if (!fitted.ok) {
      overflows.push({ key: label.key, field: fitted.field, problem: fitted.problem });
      return;
    }
    const slot = slotFor(index, start, g);
    const { xMm, yMm } = labelOrigin(g, slot.row, slot.column, offsetXMm, offsetYMm);
    placed.push({ key: label.key, page: slot.page, position: slot.position, xMm, yMm, sizePt: fitted.sizePt, rows: fitted.rows });
  });
  if (overflows.length > 0) return { ok: false, overflows };
  const sha256 = createHash("sha256")
    .update(JSON.stringify({ v: LAYOUT_VERSION, g, start, offsetXMm, offsetYMm, labels: placed }))
    .digest("hex");
  return { ok: true, pages: pageCount(labels.length, start, capacity(g)), labels: placed, sha256 };
}

// --- fonts ---------------------------------------------------------------

const FONT_DIR = join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
let fontBytes: { regular: Uint8Array; bold: Uint8Array } | null = null;
function loadFontBytes() {
  fontBytes ??= {
    regular: readFileSync(join(FONT_DIR, "DejaVuSans.ttf")),
    bold: readFileSync(join(FONT_DIR, "DejaVuSans-Bold.ttf")),
  };
  return fontBytes;
}

/** Metrics from the real embedded fonts (a throwaway document to measure with). */
let cachedMetrics: FontMetrics | null = null;
export async function fontMetrics(): Promise<FontMetrics> {
  if (cachedMetrics) return cachedMetrics;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { regular, bold } = loadFontBytes();
  const [r, b] = await Promise.all([doc.embedFont(regular), doc.embedFont(bold)]);
  cachedMetrics = metricsFor(r, b);
  return cachedMetrics;
}

function metricsFor(regular: PDFFont, bold: PDFFont): FontMetrics {
  const ascent = regular.heightAtSize(1, { descender: false });
  const total = regular.heightAtSize(1, { descender: true });
  return {
    widthOf: (text, size, isBold) => (isBold ? bold : regular).widthOfTextAtSize(text, size),
    ascent,
    descent: total - ascent,
  };
}

// --- drawing --------------------------------------------------------------

export type DrawOptions = { title: string; createdAt: Date };

async function newDocument(options: DrawOptions) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { regular, bold } = loadFontBytes();
  const [r, b] = await Promise.all([doc.embedFont(regular, { subset: true }), doc.embedFont(bold, { subset: true })]);
  // Document properties only; nothing is printed on the label pages.
  doc.setTitle(options.title);
  doc.setCreator("Triviality CRM");
  doc.setProducer("Triviality CRM");
  doc.setCreationDate(options.createdAt);
  doc.setModificationDate(options.createdAt);
  return { doc, regular: r, bold: b };
}

function addPages(doc: PDFDocument, g: SheetGeometry, count: number): PDFPage[] {
  return Array.from({ length: count }, () => doc.addPage([mmToPt(g.pageWidthMm), mmToPt(g.pageHeightMm)]));
}

/** Draw a label's rows. PDF's origin is the page's bottom-left, so y is
 * flipped from the layout's top-down millimetres. */
function drawRows(page: PDFPage, label: PlacedLabel, g: SheetGeometry, fonts: { regular: PDFFont; bold: PDFFont }, metrics: FontMetrics) {
  const pageHeight = mmToPt(g.pageHeightMm);
  const left = mmToPt(label.xMm + g.paddingMm);
  const top = pageHeight - mmToPt(label.yMm + g.paddingMm);
  label.rows.forEach((row, index) => {
    const baseline = top - metrics.ascent * label.sizePt - index * label.sizePt * g.lineHeight;
    page.drawText(row.text, { x: left, y: baseline, size: label.sizePt, font: row.bold ? fonts.bold : fonts.regular, color: rgb(0, 0, 0) });
  });
}

/** The production PDF: labels only, no borders, titles, footers or dates on
 * the pages. Blank positions before the start stay blank. */
export async function drawLabelsPdf(layout: Extract<Layout, { ok: true }>, g: SheetGeometry, options: DrawOptions): Promise<Uint8Array> {
  const { doc, regular, bold } = await newDocument(options);
  const metrics = metricsFor(regular, bold);
  const pages = addPages(doc, g, layout.pages);
  for (const label of layout.labels) drawRows(pages[label.page], label, g, { regular, bold }, metrics);
  return doc.save();
}

/** Fictional address for the calibration page. */
export const SAMPLE_LINES: LabelLine[] = [
  { text: "THE SAMPLE PUB", bold: true },
  { text: "Attn: Jane Smith", bold: false },
  { text: "123 Main Street", bold: false },
  { text: "Milton, ON", bold: false },
  { text: "L9T 1A1", bold: false },
];

/**
 * The calibration sheet, for plain paper: every label's outline, its
 * position number, the sample address placed exactly as real labels are,
 * and 50 mm rulers to check the printer isn't scaling. Plainly marked as a
 * test so it can't pass for real labels.
 */
export async function drawCalibrationPdf(g: SheetGeometry, offsetXMm: number, offsetYMm: number, options: DrawOptions): Promise<Uint8Array> {
  const { doc, regular, bold } = await newDocument(options);
  const metrics = metricsFor(regular, bold);
  const [page] = addPages(doc, g, 1);
  const pageHeight = mmToPt(g.pageHeightMm);
  const grey = rgb(0.45, 0.45, 0.45);
  const fitted = fitLabel(SAMPLE_LINES, g, metrics);

  for (let position = 1; position <= capacity(g); position++) {
    const slot = slotFor(position - 1, 1, g);
    const { xMm, yMm } = labelOrigin(g, slot.row, slot.column, offsetXMm, offsetYMm);
    page.drawRectangle({
      x: mmToPt(xMm),
      y: pageHeight - mmToPt(yMm + g.labelHeightMm),
      width: mmToPt(g.labelWidthMm),
      height: mmToPt(g.labelHeightMm),
      borderColor: grey,
      borderWidth: 0.5,
    });
    const number = String(position);
    const numberSize = 7;
    page.drawText(number, {
      x: mmToPt(xMm + g.labelWidthMm) - regular.widthOfTextAtSize(number, numberSize) - 2,
      y: pageHeight - mmToPt(yMm) - numberSize - 1,
      size: numberSize,
      font: bold,
      color: grey,
    });
    if (fitted.ok) drawRows(page, { key: number, page: 0, position, xMm, yMm, sizePt: fitted.sizePt, rows: fitted.rows }, g, { regular, bold }, metrics);
  }

  // 50 mm rulers through the middle of the page, with 10 mm ticks.
  const centreX = mmToPt(g.pageWidthMm / 2);
  const centreY = pageHeight - mmToPt(g.pageHeightMm / 2);
  const ruler = mmToPt(50);
  page.drawLine({ start: { x: centreX - ruler / 2, y: centreY }, end: { x: centreX + ruler / 2, y: centreY }, thickness: 0.75, color: rgb(0, 0, 0) });
  page.drawLine({ start: { x: centreX, y: centreY - ruler / 2 }, end: { x: centreX, y: centreY + ruler / 2 }, thickness: 0.75, color: rgb(0, 0, 0) });
  for (let mm = 0; mm <= 50; mm += 10) {
    const along = mmToPt(mm) - ruler / 2;
    page.drawLine({ start: { x: centreX + along, y: centreY - 3 }, end: { x: centreX + along, y: centreY + 3 }, thickness: 0.75, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: centreX - 3, y: centreY + along }, end: { x: centreX + 3, y: centreY + along }, thickness: 0.75, color: rgb(0, 0, 0) });
  }
  const note = "CALIBRATION TEST - NOT FOR MAILING. Each line through the centre should measure exactly 50 mm.";
  const noteSize = 8;
  const noteWidth = bold.widthOfTextAtSize(note, noteSize);
  page.drawRectangle({ x: centreX - noteWidth / 2 - 3, y: centreY - ruler / 2 - 16, width: noteWidth + 6, height: noteSize + 6, color: rgb(1, 1, 1) });
  page.drawText(note, { x: centreX - noteWidth / 2, y: centreY - ruler / 2 - 12, size: noteSize, font: bold, color: rgb(0, 0, 0) });
  return doc.save();
}
