// Pure "is this value plausible" checks for the data-quality rule engine —
// deliberately distinct from src/lib/duplicates/normalize.ts (normalizing
// FOR MATCHING) and src/lib/validation/*.ts (Zod schemas gating a form
// SUBMIT). These run over already-saved data during a scan and report a
// human-readable reason, not just a boolean, since DataQualityIssue.
// description needs to explain what's wrong.
import { normalizePhone } from "../duplicates/normalize";

export type FieldCheckResult = { valid: boolean; reason?: string };

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Common non-real placeholder domains a data-entry shortcut leaves behind —
// syntactically valid, practically useless. Not exhaustive; a false
// negative here just means the issue isn't flagged, never a false claim
// that a real address is invalid.
const SUSPICIOUS_EMAIL_DOMAINS = new Set([
  "example.com", "example.org", "example.net",
  "test.com", "test.org",
  "none.com", "noemail.com", "n-a.com", "na.com",
  "localhost",
]);

export function isValidEmailFormat(email: string): FieldCheckResult {
  const trimmed = email.trim();
  if (!EMAIL_FORMAT.test(trimmed)) {
    return { valid: false, reason: `"${email}" does not look like a valid email address.` };
  }
  if (trimmed.includes("..")) {
    return { valid: false, reason: `"${email}" contains consecutive dots, which is not a valid email address.` };
  }
  const domain = trimmed.split("@")[1]?.toLowerCase();
  if (domain && SUSPICIOUS_EMAIL_DOMAINS.has(domain)) {
    return { valid: false, reason: `"${email}" uses a placeholder domain (${domain}) rather than a real address.` };
  }
  return { valid: true };
}

// All-same-digit ("5555555555") or simple ascending/descending sequences
// ("1234567890") are the classic data-entry-shortcut fake phone numbers.
function isObviouslyFakeDigits(digits: string): boolean {
  if (/^(\d)\1+$/.test(digits)) return true;
  const ascending = "01234567890123456789".includes(digits);
  const descending = "98765432109876543210".includes(digits);
  return ascending || descending;
}

/**
 * North American phone format: normalized digit count must be 10 (or 11
 * with a leading 1), and must not be an obviously-fake pattern. Numbers
 * outside North America are out of scope for this rule (per the plan's
 * "North American phone numbers" scope) — a non-North-American number
 * simply isn't flagged by this check, rather than being incorrectly judged
 * against a rule that doesn't apply to it.
 */
export function isValidNorthAmericanPhone(phone: string): FieldCheckResult {
  const digits = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  const tenDigit = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (tenDigit.length !== 10) {
    return { valid: false, reason: `"${phone}" does not have a valid North American phone number format.` };
  }
  if (isObviouslyFakeDigits(tenDigit)) {
    return { valid: false, reason: `"${phone}" looks like a placeholder number, not a real phone number.` };
  }
  if (tenDigit[0] === "0" || tenDigit[0] === "1") {
    return { valid: false, reason: `"${phone}" has an invalid North American area code.` };
  }
  return { valid: true };
}

const SUSPICIOUS_URL_HOSTS = new Set(["example.com", "test.com", "localhost", "yourdomain.com", "yourwebsite.com"]);

export function isValidUrl(url: string): FieldCheckResult {
  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(url) ? url : `https://${url}`;
  let hostname: string;
  try {
    hostname = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return { valid: false, reason: `"${url}" is not a valid URL.` };
  }

  if (!hostname.includes(".")) {
    return { valid: false, reason: `"${url}" does not look like a real website address.` };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { valid: false, reason: `"${url}" is a bare IP address, not a website domain.` };
  }
  const bareHost = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  if (SUSPICIOUS_URL_HOSTS.has(bareHost)) {
    return { valid: false, reason: `"${url}" is a placeholder domain, not a real website.` };
  }
  return { valid: true };
}
