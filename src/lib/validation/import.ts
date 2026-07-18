import { z } from "zod";

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
] as const;

export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

const REQUIRED_FIELDS: ImportTargetField[] = ["name", "city", "region", "country"];

export const ImportMappingSchema = z.record(z.string(), z.string());
export type ImportMapping = z.infer<typeof ImportMappingSchema>;

export type MappedRow = Record<ImportTargetField, string>;

export type RowValidationResult = {
  values: MappedRow;
  errors: string[];
};

const EMPTY_ROW: MappedRow = IMPORT_TARGET_FIELDS.reduce((acc, field) => {
  acc[field] = "";
  return acc;
}, {} as MappedRow);

/** Applies a column mapping to one raw spreadsheet row and validates the
 * required CRM fields. Pure — no I/O — so it's covered by unit tests
 * without needing a real file. */
export function mapAndValidateRow(rawRow: Record<string, string>, mapping: ImportMapping): RowValidationResult {
  const values: MappedRow = { ...EMPTY_ROW };
  for (const field of IMPORT_TARGET_FIELDS) {
    const sourceColumn = mapping[field];
    values[field] = sourceColumn ? (rawRow[sourceColumn] ?? "").trim() : "";
  }

  const errors: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!values[field]) errors.push(`Missing required field "${field}".`);
  }
  if (values.email && !z.email().safeParse(values.email).success) errors.push("Invalid company email.");
  if (values.contactEmail && !z.email().safeParse(values.contactEmail).success) errors.push("Invalid contact email.");
  if (values.websiteUrl && !z.url().safeParse(values.websiteUrl).success) errors.push("Invalid website URL.");

  return { values, errors };
}
