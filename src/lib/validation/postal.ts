import type { z } from "zod";

// Strict write-time postal code validation, kept separate from
// src/lib/data-quality/normalize.ts's normalizePostalCode() — that one is a
// lenient matching key and must not change behavior; this one decides what
// is allowed to be saved.

// Canada Post never uses D, F, I, O, Q, U; W and Z also never start a code.
const CA_POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;
const US_ZIP = /^\d{5}(\d{4})?$/;

// First letter of a Canadian postal code -> the province(s) it belongs to.
const CA_POSTAL_PROVINCE: Record<string, string[]> = {
  A: ["NL"], B: ["NS"], C: ["PE"], E: ["NB"], G: ["QC"], H: ["QC"], J: ["QC"],
  K: ["ON"], L: ["ON"], M: ["ON"], N: ["ON"], P: ["ON"], R: ["MB"], S: ["SK"],
  T: ["AB"], V: ["BC"], X: ["NT", "NU"], Y: ["YT"],
};

function countryKind(country: string): "CA" | "US" | null {
  const c = country.trim().toLowerCase();
  if (c === "canada" || c === "ca" || c === "can") return "CA";
  if (["united states", "usa", "us", "u.s.", "u.s.a.", "united states of america"].includes(c)) return "US";
  return null;
}

export type PostalCodeCheck = { value: string | undefined } | { error: string };

/**
 * Validates and formats a postal/ZIP code for the given country: Canadian
 * codes become "A1A 1A1", US ZIPs "12345" or "12345-6789". A Canadian code
 * whose first letter belongs to a different province than `region` is
 * rejected. Blank stays blank, and a country other than Canada/US passes
 * through unchanged — this never invents a format it doesn't know.
 */
export function checkPostalCode(postalCode: string | null | undefined, country: string, region?: string | null): PostalCodeCheck {
  const trimmed = postalCode?.trim() ?? "";
  if (!trimmed) return { value: undefined };

  const kind = countryKind(country);
  if (kind === "CA") {
    const compact = trimmed.replace(/[\s-]+/g, "").toUpperCase();
    if (!CA_POSTAL.test(compact)) return { error: "Enter a valid Canadian postal code (e.g. L9T 2X5)." };
    const formatted = `${compact.slice(0, 3)} ${compact.slice(3)}`;
    const provinces = CA_POSTAL_PROVINCE[compact[0]];
    const province = region?.trim().toUpperCase();
    if (province && provinces && !provinces.includes(province)) {
      return { error: `Postal code ${formatted} is in ${provinces.join("/")}, not ${province}.` };
    }
    return { value: formatted };
  }
  if (kind === "US") {
    const digits = trimmed.replace(/[\s-]+/g, "");
    if (!US_ZIP.test(digits)) return { error: "Enter a valid ZIP code (e.g. 80202 or 80202-1234)." };
    return { value: digits.length === 9 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits };
  }
  return { value: trimmed };
}

/** Object-level zod transform: formats `postalCode` against `country`/`region`, or reports a postalCode issue. */
export function withCheckedPostalCode<T extends { postalCode?: string; country: string; region?: string }>(
  data: T,
  ctx: z.RefinementCtx,
): T {
  const result = checkPostalCode(data.postalCode, data.country, data.region);
  if ("error" in result) {
    ctx.addIssue({ code: "custom", path: ["postalCode"], message: result.error });
    return data;
  }
  return { ...data, postalCode: result.value };
}

/**
 * Single-field check for paths that patch one company address field at a
 * time (data-quality corrections, accepted enrichment suggestions): region
 * must be a 2-letter code, postalCode must fit the company's country and
 * province. Other fields pass through untouched.
 */
export function checkCompanyAddressField(
  field: string,
  value: string | null,
  company: { country: string; region: string },
): { value: string | null } | { error: string } {
  if (field === "region") {
    const region = value?.trim().toUpperCase() ?? "";
    return /^[A-Z]{2}$/.test(region) ? { value: region } : { error: "Enter a 2-letter state/province code (e.g. ON, CO) — not the full name." };
  }
  if (field === "postalCode") {
    const result = checkPostalCode(value, company.country, company.region);
    return "error" in result ? result : { value: result.value ?? null };
  }
  return { value };
}
