// Known Avery label products, for "Add a label sheet": type the number and
// the label size, count and layout fill in, so only the margins need a
// ruler.
//
// What's verified: Avery's own product pages (avery.com/products/labels/
// <number>, read 2026-11-06) state each product's label size and labels per
// sheet, and the US products are Letter sheets. Avery does NOT publish the
// margins or spacing on any page reached, so those are never stored here;
// the form asks for the top and left margin and works out the gaps from
// them. The rows x columns layout is the only arrangement of that many
// labels of that size that fits on a Letter page, not an Avery statement.
// Always print the calibration page before using real labels.
import { inchToMm } from "./geometry";

export type AveryPreset = {
  number: string;
  description: string;
  labelWidthIn: number;
  labelHeightIn: number;
  columns: number;
  rows: number;
};

const LETTER = { widthMm: inchToMm(8.5), heightMm: inchToMm(11) };
export const PRESET_PAGE = LETTER;
export const PRESET_SOURCE_DATE = "6 Nov 2026";

const ADDRESS_30: Omit<AveryPreset, "number"> = { description: "Address labels, 1\" x 2-5/8\", 30 per sheet", labelWidthIn: 2.625, labelHeightIn: 1, columns: 3, rows: 10 };
const SHIPPING_10: Omit<AveryPreset, "number"> = { description: "Shipping labels, 2\" x 4\", 10 per sheet", labelWidthIn: 4, labelHeightIn: 2, columns: 2, rows: 5 };

export const AVERY_PRESETS: AveryPreset[] = [
  { number: "5160", ...ADDRESS_30 },
  { number: "8160", ...ADDRESS_30 },
  { number: "18160", ...ADDRESS_30 },
  { number: "5260", ...ADDRESS_30 },
  { number: "5161", description: "Address labels, 1\" x 4\", 20 per sheet", labelWidthIn: 4, labelHeightIn: 1, columns: 2, rows: 10 },
  { number: "5162", description: "Address labels, 1-1/3\" x 4\", 14 per sheet", labelWidthIn: 4, labelHeightIn: 4 / 3, columns: 2, rows: 7 },
  { number: "5163", ...SHIPPING_10 },
  { number: "8163", ...SHIPPING_10 },
  { number: "18163", ...SHIPPING_10 },
  { number: "5164", description: "Shipping labels, 3-1/3\" x 4\", 6 per sheet", labelWidthIn: 4, labelHeightIn: 10 / 3, columns: 2, rows: 3 },
  { number: "5167", description: "Return address labels, 1/2\" x 1-3/4\", 80 per sheet", labelWidthIn: 1.75, labelHeightIn: 0.5, columns: 4, rows: 20 },
];

/** The preset for a typed number ("Avery 5160", "5160", " 5160 "), or null. */
export function findAveryPreset(typed: string): AveryPreset | null {
  const number = typed.replace(/avery/i, "").replace(/[^0-9]/g, "");
  return AVERY_PRESETS.find((preset) => preset.number === number) ?? null;
}

/**
 * The gaps between labels, from the margins measured on the sheet, assuming
 * the right margin equals the left and the bottom equals the top (how these
 * sheets are made). Null when the margins leave no room.
 */
export function gapsFromMargins(preset: AveryPreset, topMm: number, leftMm: number): { gapXMm: number; gapYMm: number } | null {
  const w = inchToMm(preset.labelWidthIn);
  const h = inchToMm(preset.labelHeightIn);
  const spareX = LETTER.widthMm - 2 * leftMm - preset.columns * w;
  const spareY = LETTER.heightMm - 2 * topMm - preset.rows * h;
  const round = (mm: number) => Math.round(mm * 1000) / 1000;
  const gapXMm = preset.columns > 1 ? round(spareX / (preset.columns - 1)) : 0;
  const gapYMm = preset.rows > 1 ? round(spareY / (preset.rows - 1)) : 0;
  // A hair negative from rounding a tight fit counts as touching.
  const clean = (gap: number) => (gap > -0.05 && gap < 0 ? 0 : gap);
  const result = { gapXMm: clean(gapXMm), gapYMm: clean(gapYMm) };
  return result.gapXMm < 0 || result.gapYMm < 0 ? null : result;
}
