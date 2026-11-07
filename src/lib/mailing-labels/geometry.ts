// Label sheet geometry: validation, where each label sits, and how many pages
// a job takes. Pure functions, all in millimetres; PDF points only appear in
// mmToPt(), at the drawing boundary.

/** 1 inch = 25.4 mm exactly; 1 PDF point = 1/72 inch. */
export const MM_PER_INCH = 25.4;
export function mmToPt(mm: number): number {
  return (mm * 72) / MM_PER_INCH;
}
export function inchToMm(inches: number): number {
  return inches * MM_PER_INCH;
}

export type SheetGeometry = {
  pageWidthMm: number;
  pageHeightMm: number;
  rows: number;
  columns: number;
  labelWidthMm: number;
  labelHeightMm: number;
  topMm: number;
  leftMm: number;
  gapXMm: number;
  gapYMm: number;
  paddingMm: number;
  preferredFontPt: number;
  minFontPt: number;
  lineHeight: number;
};

/** Sane bounds, so a typo (or a hostile request) can't ask for a 10,000-label
 * page or a 5 m sheet. */
export const LIMITS = {
  maxPageMm: 600,
  maxRows: 40,
  maxColumns: 12,
  minLabelMm: 5,
  minFontPt: 6,
  maxFontPt: 24,
  minLineHeight: 1,
  maxLineHeight: 2,
} as const;

// Fit checks compare sums of floats; allow a hair of rounding.
const EPSILON_MM = 0.001;

/** Every problem with the geometry, in plain words; empty when it's usable. */
export function validateGeometry(g: SheetGeometry): string[] {
  const errors: string[] = [];
  const numbers: [keyof SheetGeometry, string][] = [
    ["pageWidthMm", "Page width"],
    ["pageHeightMm", "Page height"],
    ["labelWidthMm", "Label width"],
    ["labelHeightMm", "Label height"],
    ["topMm", "Top margin"],
    ["leftMm", "Left margin"],
    ["gapXMm", "Horizontal gap"],
    ["gapYMm", "Vertical gap"],
    ["paddingMm", "Inner padding"],
    ["preferredFontPt", "Preferred font size"],
    ["minFontPt", "Minimum font size"],
    ["lineHeight", "Line height"],
  ];
  for (const [key, label] of numbers) {
    if (!Number.isFinite(g[key])) errors.push(`${label} must be a number.`);
  }
  if (errors.length > 0) return errors;

  if (g.pageWidthMm <= 0 || g.pageHeightMm <= 0) errors.push("The page width and height must be more than 0.");
  if (g.pageWidthMm > LIMITS.maxPageMm || g.pageHeightMm > LIMITS.maxPageMm) errors.push(`The page can be at most ${LIMITS.maxPageMm} mm on a side.`);
  if (!Number.isInteger(g.rows) || g.rows < 1 || g.rows > LIMITS.maxRows) errors.push(`Rows must be a whole number from 1 to ${LIMITS.maxRows}.`);
  if (!Number.isInteger(g.columns) || g.columns < 1 || g.columns > LIMITS.maxColumns) errors.push(`Columns must be a whole number from 1 to ${LIMITS.maxColumns}.`);
  if (g.labelWidthMm < LIMITS.minLabelMm || g.labelHeightMm < LIMITS.minLabelMm) errors.push(`A label must be at least ${LIMITS.minLabelMm} mm wide and tall.`);
  if (g.topMm < 0 || g.leftMm < 0) errors.push("The top and left margins can't be negative.");
  if (g.gapXMm < 0 || g.gapYMm < 0) errors.push("The gaps between labels can't be negative.");
  if (g.paddingMm < 0) errors.push("The inner padding can't be negative.");
  if (g.labelWidthMm - 2 * g.paddingMm < LIMITS.minLabelMm || g.labelHeightMm - 2 * g.paddingMm < LIMITS.minLabelMm)
    errors.push("The inner padding leaves too little room for text.");
  if (g.minFontPt < LIMITS.minFontPt || g.preferredFontPt > LIMITS.maxFontPt) errors.push(`Font sizes must be between ${LIMITS.minFontPt} and ${LIMITS.maxFontPt} points.`);
  if (g.minFontPt > g.preferredFontPt) errors.push("The minimum font size can't be bigger than the preferred size.");
  if (g.lineHeight < LIMITS.minLineHeight || g.lineHeight > LIMITS.maxLineHeight) errors.push(`Line height must be between ${LIMITS.minLineHeight} and ${LIMITS.maxLineHeight}.`);
  if (errors.length > 0) return errors;

  const usedWidth = g.leftMm + g.columns * g.labelWidthMm + (g.columns - 1) * g.gapXMm;
  const usedHeight = g.topMm + g.rows * g.labelHeightMm + (g.rows - 1) * g.gapYMm;
  if (usedWidth > g.pageWidthMm + EPSILON_MM) errors.push(`The labels don't fit across the page: they need ${round(usedWidth)} mm of ${round(g.pageWidthMm)} mm.`);
  if (usedHeight > g.pageHeightMm + EPSILON_MM) errors.push(`The labels don't fit down the page: they need ${round(usedHeight)} mm of ${round(g.pageHeightMm)} mm.`);
  return errors;
}

function round(mm: number): number {
  return Math.round(mm * 100) / 100;
}

export function capacity(g: Pick<SheetGeometry, "rows" | "columns">): number {
  return g.rows * g.columns;
}

/** Whether `start` (1-based) is a valid first position on this sheet. */
export function validStartPosition(g: Pick<SheetGeometry, "rows" | "columns">, start: number): boolean {
  return Number.isInteger(start) && start >= 1 && start <= capacity(g);
}

/**
 * Pages for `count` labels starting at position `start` on the first sheet
 * (later sheets start at 1): ceil((N + start - 1) / capacity). Zero labels
 * is zero pages, never a blank sheet.
 */
export function pageCount(count: number, start: number, perSheet: number): number {
  if (count <= 0) return 0;
  return Math.ceil((count + start - 1) / perSheet);
}

/** Unused positions left on the last sheet. */
export function unusedOnLastPage(count: number, start: number, perSheet: number): number {
  if (count <= 0) return 0;
  const used = (count + start - 1) % perSheet;
  return used === 0 ? 0 : perSheet - used;
}

export type Slot = { page: number; position: number; row: number; column: number };

/**
 * Where label i (0-based, in print order) goes. Positions number across
 * each row left to right, then down; the first sheet skips the positions
 * before `start`, which stay blank.
 */
export function slotFor(index: number, start: number, g: Pick<SheetGeometry, "rows" | "columns">): Slot {
  const perSheet = capacity(g);
  const absolute = index + start - 1;
  const page = Math.floor(absolute / perSheet);
  const offset = absolute % perSheet;
  return { page, position: offset + 1, row: Math.floor(offset / g.columns), column: offset % g.columns };
}

/** Top-left corner of the label at (row, column), in mm from the page's
 * top-left, after the printer correction (positive X right, positive Y down). */
export function labelOrigin(g: SheetGeometry, row: number, column: number, offsetXMm = 0, offsetYMm = 0): { xMm: number; yMm: number } {
  return {
    xMm: g.leftMm + column * (g.labelWidthMm + g.gapXMm) + offsetXMm,
    yMm: g.topMm + row * (g.labelHeightMm + g.gapYMm) + offsetYMm,
  };
}

/** Whether every label still lands on the page once the offset is applied. */
export function offsetKeepsLabelsOnPage(g: SheetGeometry, offsetXMm: number, offsetYMm: number): boolean {
  const first = labelOrigin(g, 0, 0, offsetXMm, offsetYMm);
  const last = labelOrigin(g, g.rows - 1, g.columns - 1, offsetXMm, offsetYMm);
  return (
    first.xMm >= -EPSILON_MM &&
    first.yMm >= -EPSILON_MM &&
    last.xMm + g.labelWidthMm <= g.pageWidthMm + EPSILON_MM &&
    last.yMm + g.labelHeightMm <= g.pageHeightMm + EPSILON_MM
  );
}

/** The largest correction anyone should need; bigger is a geometry problem. */
export const MAX_OFFSET_MM = 10;
