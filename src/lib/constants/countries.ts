// The two countries the CRM works in. Every form that asks for a country
// offers just these, saved under the same values the lead-search forms have
// always used ("Canada" / "United States") so existing data still matches.

export const COUNTRY_OPTIONS = [
  { value: "Canada", label: "Canada" },
  { value: "United States", label: "USA" },
] as const;

/** Lower-case spellings of each country found in imported/typed data. */
export const CANADA_SPELLINGS = ["canada", "ca", "can"];
export const UNITED_STATES_SPELLINGS = ["united states", "usa", "us", "u.s.", "u.s.a.", "united states of america"];

/** "Canada" or "United States" for any common spelling of either; otherwise
 * the value trimmed but unchanged (an older record's odd country is kept,
 * never silently rewritten). */
export function canonicalCountry(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (CANADA_SPELLINGS.includes(lower)) return "Canada";
  if (UNITED_STATES_SPELLINGS.includes(lower)) return "United States";
  return trimmed;
}

/** Every spelling a country filter should match — picking "United States"
 * also finds companies saved as "USA" or "US". */
export function countrySpellings(value: string): string[] {
  const canonical = canonicalCountry(value);
  if (canonical === "Canada") return CANADA_SPELLINGS;
  if (canonical === "United States") return UNITED_STATES_SPELLINGS;
  return [value.trim()];
}
