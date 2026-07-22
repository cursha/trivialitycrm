// Module Seven: address/name normalization for data-quality matching,
// deliberately kept SEPARATE from src/lib/duplicates/normalize.ts and its
// computeNormalizedFields() (src/lib/duplicates/match.ts). That function's
// return value is spread directly onto SearchResult.upsert() in
// src/lib/research/run-search.ts, which has no normalizedRegion/City/
// PostalCode columns — extending its shape would break the AI-research
// pipeline. This module reuses normalizePhone/normalizeEmail/
// normalizeAddressLine from there (generic, safe to reuse) rather than
// re-implementing them, and adds only what Company/Contact need that
// SearchResult does not.
import { normalizePhone, normalizeEmail } from "../duplicates/normalize";

export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Keyed by lowercased full name AND lowercased 2-letter code, both mapping
// to the canonical uppercase code — so "California", "california", and "ca"
// all normalize identically. Never guesses: an unrecognized region falls
// back to a trimmed/lowercased passthrough rather than inventing a code.
const US_STATES: Record<string, string> = {
  alabama: "AL", al: "AL",
  alaska: "AK", ak: "AK",
  arizona: "AZ", az: "AZ",
  arkansas: "AR", ar: "AR",
  california: "CA", ca: "CA",
  colorado: "CO", co: "CO",
  connecticut: "CT", ct: "CT",
  delaware: "DE", de: "DE",
  florida: "FL", fl: "FL",
  georgia: "GA", ga: "GA",
  hawaii: "HI", hi: "HI",
  idaho: "ID", id: "ID",
  illinois: "IL", il: "IL",
  indiana: "IN", in: "IN",
  iowa: "IA", ia: "IA",
  kansas: "KS", ks: "KS",
  kentucky: "KY", ky: "KY",
  louisiana: "LA", la: "LA",
  maine: "ME", me: "ME",
  maryland: "MD", md: "MD",
  massachusetts: "MA", ma: "MA",
  michigan: "MI", mi: "MI",
  minnesota: "MN", mn: "MN",
  mississippi: "MS", ms: "MS",
  missouri: "MO", mo: "MO",
  montana: "MT", mt: "MT",
  nebraska: "NE", ne: "NE",
  nevada: "NV", nv: "NV",
  "new hampshire": "NH", nh: "NH",
  "new jersey": "NJ", nj: "NJ",
  "new mexico": "NM", nm: "NM",
  "new york": "NY", ny: "NY",
  "north carolina": "NC", nc: "NC",
  "north dakota": "ND", nd: "ND",
  ohio: "OH", oh: "OH",
  oklahoma: "OK", ok: "OK",
  oregon: "OR", or: "OR",
  pennsylvania: "PA", pa: "PA",
  "rhode island": "RI", ri: "RI",
  "south carolina": "SC", sc: "SC",
  "south dakota": "SD", sd: "SD",
  tennessee: "TN", tn: "TN",
  texas: "TX", tx: "TX",
  utah: "UT", ut: "UT",
  vermont: "VT", vt: "VT",
  virginia: "VA", va: "VA",
  washington: "WA", wa: "WA",
  "west virginia": "WV", wv: "WV",
  wisconsin: "WI", wi: "WI",
  wyoming: "WY", wy: "WY",
  "district of columbia": "DC", dc: "DC",
};

const CA_PROVINCES: Record<string, string> = {
  alberta: "AB", ab: "AB",
  "british columbia": "BC", bc: "BC",
  manitoba: "MB", mb: "MB",
  "new brunswick": "NB", nb: "NB",
  "newfoundland and labrador": "NL", nl: "NL",
  "nova scotia": "NS", ns: "NS",
  ontario: "ON", on: "ON",
  "prince edward island": "PE", pe: "PE",
  quebec: "QC", qc: "QC",
  "québec": "QC",
  saskatchewan: "SK", sk: "SK",
  "northwest territories": "NT", nt: "NT",
  nunavut: "NU", nu: "NU",
  yukon: "YT", yt: "YT",
};

function isCanada(country: string): boolean {
  const c = country.trim().toLowerCase();
  return c === "canada" || c === "ca" || c === "can";
}

function isUnitedStates(country: string): boolean {
  const c = country.trim().toLowerCase();
  return c === "united states" || c === "usa" || c === "us" || c === "u.s." || c === "u.s.a." || c === "united states of america";
}

/**
 * Maps a free-text state/province to its canonical 2-letter code for the
 * given country. Falls back to a trimmed, lowercased passthrough when
 * `country` isn't recognized as US/Canada or the value isn't in the lookup
 * table — never invents a code for an input it doesn't recognize.
 */
export function normalizeRegion(region: string, country: string): string {
  const key = region.trim().toLowerCase();
  if (!key) return "";

  if (isUnitedStates(country) && US_STATES[key]) return US_STATES[key];
  if (isCanada(country) && CA_PROVINCES[key]) return CA_PROVINCES[key];
  return key;
}

/**
 * Normalizes a US ZIP or Canadian postal code for matching. Returns null
 * for a country/format combination this doesn't recognize — never guesses
 * or invents a canonical form for a code that doesn't look valid.
 */
export function normalizePostalCode(postalCode: string, country: string): string | null {
  const trimmed = postalCode.trim();
  if (!trimmed) return null;

  if (isUnitedStates(country)) {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 5) return digits;
    if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
    return null;
  }

  if (isCanada(country)) {
    const compact = trimmed.replace(/\s+/g, "").toUpperCase();
    if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) {
      return `${compact.slice(0, 3)} ${compact.slice(3)}`;
    }
    return null;
  }

  return null;
}

export type AddressNormalizedFields = {
  normalizedRegion: string | null;
  normalizedCity: string | null;
  normalizedPostalCode: string | null;
};

/**
 * Computes Company's address-matching normalized fields — the new, separate
 * function per this module's plan (see this file's header comment). Never
 * called anywhere near SearchResult; only Company/Contact write paths and
 * the data-quality scan use this.
 */
export function computeAddressNormalizedFields(input: {
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): AddressNormalizedFields {
  const country = input.country ?? "";
  return {
    normalizedCity: input.city ? normalizeCity(input.city) : null,
    normalizedRegion: input.region ? normalizeRegion(input.region, country) : null,
    normalizedPostalCode: input.postalCode ? normalizePostalCode(input.postalCode, country) : null,
  };
}

export type ContactNormalizedFields = {
  normalizedFirstName: string | null;
  normalizedLastName: string | null;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
};

export function computeContactNormalizedFields(input: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
}): ContactNormalizedFields {
  return {
    normalizedFirstName: input.firstName ? normalizePersonName(input.firstName) : null,
    normalizedLastName: input.lastName ? normalizePersonName(input.lastName) : null,
    normalizedPhone: input.phone ? normalizePhone(input.phone) : null,
    normalizedEmail: input.email ? normalizeEmail(input.email) : null,
  };
}
