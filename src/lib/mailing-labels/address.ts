// Turning a company's address into label lines, and deciding whether it's
// complete enough to mail. One formatter for review, preview, PDF and the
// stored snapshot, so they can never disagree.
import { canonicalCountry } from "../constants/countries";
import { CA_PROVINCES, US_STATES } from "../constants/north-american-regions";

export type LabelLine = { text: string; bold: boolean };

export type AddressSource = {
  name: string;
  address1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
};

/** The two destinations this release can format. */
export type SupportedCountry = "Canada" | "United States";

/** Collapse runs of whitespace and trim; null when nothing is left. */
export function tidy(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

const CA_POSTAL = /^([A-Za-z]\d[A-Za-z])\s*-?\s*(\d[A-Za-z]\d)$/;
const US_ZIP = /^(\d{5})(?:\s*-\s*(\d{4}))?$/;

/** "l9t1a1" -> "L9T 1A1" for a recognizable Canadian code; anything else
 * comes back tidied but otherwise as entered (the stored value is never
 * changed). */
export function formatPostalCode(postal: string, country: SupportedCountry): string {
  const value = tidy(postal) ?? "";
  if (country === "Canada") {
    const match = value.match(CA_POSTAL);
    return match ? `${match[1]} ${match[2]}`.toUpperCase() : value.toUpperCase();
  }
  // ZIP codes stay strings: leading zeros and ZIP+4 are kept.
  const match = value.match(US_ZIP);
  return match ? (match[2] ? `${match[1]}-${match[2]}` : match[1]) : value;
}

export function postalCodeLooksValid(postal: string, country: SupportedCountry): boolean {
  const value = tidy(postal) ?? "";
  return country === "Canada" ? CA_POSTAL.test(value) : US_ZIP.test(value);
}

const REGION_CODES: Record<SupportedCountry, Map<string, string>> = {
  Canada: new Map(CA_PROVINCES.flatMap((r) => [[r.code.toLowerCase(), r.code], [r.label.toLowerCase(), r.code]])),
  "United States": new Map(US_STATES.flatMap((r) => [[r.code.toLowerCase(), r.code], [r.label.toLowerCase(), r.code]])),
};

/** "on" or "Ontario" -> "ON"; null when it isn't a province/state of that country. */
export function regionCode(region: string, country: SupportedCountry): string | null {
  return REGION_CODES[country].get((tidy(region) ?? "").toLowerCase()) ?? null;
}

export function supportedCountry(country: string | null | undefined): SupportedCountry | null {
  const canonical = canonicalCountry(country);
  return canonical === "Canada" || canonical === "United States" ? canonical : null;
}

/** The country line for mail leaving the sender's country (none for domestic). */
function countryLine(destination: SupportedCountry, sender: SupportedCountry | null): string | null {
  if (sender === destination) return null;
  return destination === "Canada" ? "CANADA" : "USA";
}

export type AddressCheck =
  | { ok: true; street: string; cityLine: string; postal: string; country: SupportedCountry; countryLine: string | null; warnings: string[] }
  | { ok: false; reasons: string[] };

/**
 * Whether this address can go on a label, and its lines if so. Missing
 * company name, street, city, province/state, postal/ZIP code or an
 * unrecognized country blocks it with the exact reason. A postal code that
 * doesn't look right is a warning, not a block: plausibility isn't proof
 * either way.
 */
export function checkAddress(source: AddressSource, senderCountry: string | null): AddressCheck {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const name = tidy(source.name);
  const street = tidy(source.address1);
  const city = tidy(source.city);
  const region = tidy(source.region);
  const postal = tidy(source.postalCode);
  const rawCountry = tidy(source.country);
  const country = supportedCountry(rawCountry);

  if (!name) reasons.push("Missing company name");
  if (!street) reasons.push("Missing street address");
  if (!city) reasons.push("Missing city");
  if (!region) reasons.push("Missing province/state");
  if (!postal) reasons.push("Missing postal/ZIP code");
  if (!rawCountry) reasons.push("Missing country");
  else if (!country) reasons.push(`Country "${rawCountry}" isn't supported for labels yet (Canada and the US only)`);

  const sender = supportedCountry(senderCountry);
  if (country && !sender) {
    // Without a sender country there's no telling domestic from international.
    reasons.push("Set the workspace's default country (Settings) before printing labels");
  }
  if (reasons.length > 0 || !country || !street || !city || !region || !postal) return { ok: false, reasons };

  const code = regionCode(region, country);
  if (!code) warnings.push(`"${region}" isn't a ${country === "Canada" ? "Canadian province" : "US state"} code`);
  if (!postalCodeLooksValid(postal, country)) warnings.push(`The ${country === "Canada" ? "postal code" : "ZIP code"} "${postal}" doesn't look right`);

  return {
    ok: true,
    street,
    cityLine: `${city}, ${code ?? region.toUpperCase()}`,
    postal: formatPostalCode(postal, country),
    country,
    countryLine: countryLine(country, sender),
    warnings,
  };
}

/**
 * The label's lines, in order: COMPANY (bold, capitals — a rendering rule;
 * the stored name is never changed), Attn line, street, "City, RG", postal
 * code, then the country only for mail leaving the sender's country.
 */
export function labelLines(companyName: string, attention: string, address: Extract<AddressCheck, { ok: true }>): LabelLine[] {
  const lines: LabelLine[] = [
    { text: (tidy(companyName) ?? "").toUpperCase(), bold: true },
    { text: `Attn: ${attention}`, bold: false },
    { text: address.street, bold: false },
    { text: address.cityLine, bold: false },
    { text: address.postal, bold: false },
  ];
  if (address.countryLine) lines.push({ text: address.countryLine, bold: false });
  return lines;
}
