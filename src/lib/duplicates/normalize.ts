// Shared normalization for duplicate matching AND for populating the
// Company.normalizedName / normalizedPhone / normalizedEmail / websiteDomain
// columns on write. Reused by future AI-transfer and spreadsheet-import
// flows — keep this free of any request/DB-specific concerns.

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|co|corp|corporation)\.?\b/g;

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    // Apostrophes (straight or curly) almost always sit inside a single
    // word (contraction/possessive) — drop them rather than treating them
    // as a word separator, so "O'Malley's" and "OMalleys" normalize alike.
    .replace(/['’]/g, "")
    .replace(COMPANY_SUFFIXES, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractWebsiteDomain(url: string): string | null {
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(url) ? url : `https://${url}`;
    const hostname = new URL(withScheme).hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}

const STREET_ABBREVIATIONS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  boulevard: "blvd",
  drive: "dr",
  road: "rd",
  lane: "ln",
  court: "ct",
  place: "pl",
  suite: "ste",
};

export function normalizeAddressLine(address1: string): string {
  const normalized = address1
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  return normalized
    .split(" ")
    .map((word) => STREET_ABBREVIATIONS[word] ?? word)
    .join(" ");
}
