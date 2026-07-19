// OWASP CSV/formula-injection guidance: a cell value opened by Excel/Sheets/
// LibreOffice is interpreted as a live formula if it starts with any of
// these characters (after leading whitespace). Tab and CR are included
// because some spreadsheet apps also treat them as formula-triggering in
// certain locales/import paths.
const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@", "\t", "\r"];

function leadingTriggerChar(value: string): string | null {
  if (value.length === 0) return null;
  const first = value[0];
  return FORMULA_TRIGGER_CHARS.includes(first) ? first : null;
}

/** True if a value would be interpreted as a formula by a spreadsheet application when
 * opened — used on import to flag (not silently mangle) suspicious values, since a
 * legitimate value like a company named "-24 Grill" shouldn't be corrupted. */
export function looksLikeFormulaInjection(value: string): boolean {
  return leadingTriggerChar(value) !== null;
}

/** Neutralizes a value for export by prefixing it with a single quote when it would
 * otherwise be interpreted as a formula — applied unconditionally on every exported cell,
 * per OWASP CSV-injection guidance. Values that don't start with a trigger character pass
 * through unchanged. */
export function neutralizeForExport(value: string): string {
  return leadingTriggerChar(value) !== null ? `'${value}` : value;
}
