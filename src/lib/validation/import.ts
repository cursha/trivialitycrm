import { z } from "zod";
import { looksLikeFormulaInjection } from "@/lib/security/formula-injection";
import { titleCaseCity } from "@/lib/text-case";
import { checkPostalCode } from "@/lib/validation/postal";

export const IMPORT_TARGET_FIELDS = [
  "name",
  "address1",
  "city",
  "region",
  "postalCode",
  "country",
  "phone",
  "email",
  "websiteUrl",
  "contactFirstName",
  "contactLastName",
  "contactPhone",
  "contactEmail",
  "contactTitle",
  "contactNote",
  // Lead research. Scoring-owned fields (eosScore, opportunityGrade,
  // salesPriorityScore, confidenceLevel, scoreExplanation, ...) are
  // deliberately absent: only the app's own scoring writes those.
  "notes",
  "researchPriority",
  "currentEntertainment",
  "triviaStatus",
  "competitorTriviaProvider",
  "competitorTriviaDay",
  "slowNight",
  "triviaHistory",
  "verifiedEvidenceSummary",
  "inferredEvidenceSummary",
  "missingInformation",
  "recommendedSalesApproach",
  "recommendedNextAction",
  "needsReview",
] as const;

export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportTargetField, string> = {
  name: "Company name *",
  address1: "Address",
  city: "City *",
  region: "State/Province *",
  postalCode: "Postal code",
  country: "Country *",
  phone: "Phone",
  email: "Email",
  websiteUrl: "Website",
  contactFirstName: "Contact first name",
  contactLastName: "Contact last name",
  contactPhone: "Contact phone",
  contactEmail: "Contact email",
  contactTitle: "Contact title",
  contactNote: "Contact note",
  notes: "Notes",
  researchPriority: "Research priority (High/Medium/Low)",
  currentEntertainment: "Entertainment now",
  triviaStatus: "Runs trivia now? (yes/no/unknown)",
  competitorTriviaProvider: "Trivia provider now",
  competitorTriviaDay: "Trivia night",
  slowNight: "Slow night",
  triviaHistory: "Trivia history",
  verifiedEvidenceSummary: "Verified evidence",
  inferredEvidenceSummary: "Inferred evidence",
  missingInformation: "What still needs confirming",
  recommendedSalesApproach: "Recommended sales approach",
  recommendedNextAction: "Recommended next action",
  needsReview: "Needs review (yes/no)",
};

const REQUIRED_FIELDS: ImportTargetField[] = ["name", "city", "region", "country"];

export const ImportMappingSchema = z.record(z.string(), z.string());
export type ImportMapping = z.infer<typeof ImportMappingSchema>;

export type MappedRow = Record<ImportTargetField, string>;

export type RowValidationResult = {
  values: MappedRow;
  errors: string[];
  // Non-blocking — a value starting with =, +, -, @, tab, or CR is flagged
  // for the user to double-check (a legitimate business name can start with
  // "-", so this must never silently block or mangle the row), but is not
  // treated as invalid. The actual protection against formula execution
  // happens unconditionally at export time (see src/lib/security/formula-injection.ts
  // and src/lib/export/serialize.ts), not by rejecting the import.
  warnings: string[];
};

const EMPTY_ROW: MappedRow = IMPORT_TARGET_FIELDS.reduce((acc, field) => {
  acc[field] = "";
  return acc;
}, {} as MappedRow);

/** Maps each field to the column whose header is exactly its key, ignoring
 * case and surrounding spaces — so a CSV written with the field keys as
 * headers (as lead research produces) maps itself. */
export function autoMapHeaders(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  for (const field of IMPORT_TARGET_FIELDS) {
    const header = headers.find((h) => h.trim().toLowerCase() === field.toLowerCase());
    if (header !== undefined) mapping[field] = header;
  }
  return mapping;
}

export const IMPORT_WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type ImportWeekday = (typeof IMPORT_WEEKDAYS)[number];

const WEEKDAY_ALIASES: Record<string, ImportWeekday> = {
  mon: "MONDAY",
  tue: "TUESDAY",
  tues: "TUESDAY",
  wed: "WEDNESDAY",
  weds: "WEDNESDAY",
  thu: "THURSDAY",
  thur: "THURSDAY",
  thurs: "THURSDAY",
  fri: "FRIDAY",
  sat: "SATURDAY",
  sun: "SUNDAY",
};

/** "Tue", "Tues", "Tuesday", "TUESDAY", "Tuesdays" → TUESDAY; anything else null. */
export function parseWeekday(raw: string): ImportWeekday | null {
  const value = raw.trim().toLowerCase().replace(/\.$/, "");
  const full = IMPORT_WEEKDAYS.find((day) => day.toLowerCase() === value || `${day.toLowerCase()}s` === value);
  return full ?? WEEKDAY_ALIASES[value] ?? null;
}

export type ImportTriviaStatus = "CURRENT_TRIVIA" | "NO_CURRENT_TRIVIA" | "UNCERTAIN";

/** The enum values themselves, plus yes/current → CURRENT_TRIVIA,
 * no/none → NO_CURRENT_TRIVIA, blank/unknown → UNCERTAIN. */
export function parseTriviaStatus(raw: string): ImportTriviaStatus | null {
  const value = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["CURRENT_TRIVIA", "YES", "Y", "CURRENT", "TRUE"].includes(value)) return "CURRENT_TRIVIA";
  if (["NO_CURRENT_TRIVIA", "NO", "N", "NONE", "FALSE"].includes(value)) return "NO_CURRENT_TRIVIA";
  if (["UNCERTAIN", "", "UNKNOWN"].includes(value)) return "UNCERTAIN";
  return null;
}

/** yes/no/true/false/1/0 (any case); blank is false. */
export function parseYesNo(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(value)) return true;
  if (["no", "n", "false", "0", ""].includes(value)) return false;
  return null;
}

/** High/Medium/Low (any case), returned capitalized. */
export function parseResearchPriority(raw: string): "High" | "Medium" | "Low" | null {
  const value = raw.trim().toLowerCase();
  if (value === "high") return "High";
  if (value === "medium") return "Medium";
  if (value === "low") return "Low";
  return null;
}

/** Applies a column mapping to one raw spreadsheet row and validates the
 * required CRM fields. Pure — no I/O — so it's covered by unit tests
 * without needing a real file. Enum-like fields come back in their stored
 * form: triviaStatus "CURRENT_TRIVIA", days "TUESDAY", needsReview
 * "true"/"false", researchPriority "High". */
export function mapAndValidateRow(rawRow: Record<string, string>, mapping: ImportMapping): RowValidationResult {
  const values: MappedRow = { ...EMPTY_ROW };
  for (const field of IMPORT_TARGET_FIELDS) {
    const sourceColumn = mapping[field];
    values[field] = sourceColumn ? (rawRow[sourceColumn] ?? "").trim() : "";
  }
  if (values.city) values.city = titleCaseCity(values.city);
  if (values.region) values.region = values.region.toUpperCase();

  const errors: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!values[field]) errors.push(`Missing required field "${field}".`);
  }
  if (values.region && values.region.length !== 2) errors.push("Region must be a 2-letter state/province code (e.g. ON, CO) — not the full name.");
  if (values.postalCode) {
    const postal = checkPostalCode(values.postalCode, values.country, values.region);
    if ("error" in postal) errors.push(postal.error);
    else values.postalCode = postal.value ?? "";
  }
  if (values.email && !z.email().safeParse(values.email).success) errors.push("Invalid company email.");
  if (values.contactEmail && !z.email().safeParse(values.contactEmail).success) errors.push("Invalid contact email.");
  if (values.websiteUrl && !z.url().safeParse(values.websiteUrl).success) errors.push("Invalid website URL.");

  // Checked against the raw text, before the enum fields below are
  // rewritten into their stored form.
  const warnings: string[] = [];
  for (const field of IMPORT_TARGET_FIELDS) {
    if (values[field] && looksLikeFormulaInjection(values[field])) {
      warnings.push(`Field "${field}" starts with a character a spreadsheet could interpret as a formula — please verify this value.`);
    }
  }

  if (values.researchPriority) {
    const priority = parseResearchPriority(values.researchPriority);
    if (priority) values.researchPriority = priority;
    else errors.push(`Research priority "${values.researchPriority}" must be High, Medium or Low.`);
  }
  const triviaStatus = parseTriviaStatus(values.triviaStatus);
  if (triviaStatus) values.triviaStatus = triviaStatus;
  else errors.push(`Runs trivia now "${values.triviaStatus}" must be yes, no or unknown (or CURRENT_TRIVIA, NO_CURRENT_TRIVIA, UNCERTAIN).`);
  for (const field of ["competitorTriviaDay", "slowNight"] as const) {
    if (!values[field]) continue;
    const day = parseWeekday(values[field]);
    if (day) values[field] = day;
    else errors.push(`${IMPORT_FIELD_LABELS[field]} "${values[field]}" must be a day of the week (e.g. Tue or Tuesday).`);
  }
  const needsReview = parseYesNo(values.needsReview);
  if (needsReview === null) errors.push(`Needs review "${values.needsReview}" must be yes or no.`);
  else values.needsReview = needsReview ? "true" : "false";

  // Contact first and last names are both required everywhere in the app,
  // so a half-named contact is kept as a company note instead of being lost.
  const hasFirst = !!values.contactFirstName;
  const hasLast = !!values.contactLastName;
  if (hasFirst && !hasLast) warnings.push("No last name, so this contact will be saved as a company note.");
  else if (hasLast && !hasFirst) warnings.push("No first name, so this contact will be saved as a company note.");
  else if (!hasFirst && !hasLast && (values.contactTitle || values.contactPhone || values.contactEmail)) {
    warnings.push("No contact name, so these contact details will be saved as a company note.");
  }

  return { values, errors, warnings };
}
