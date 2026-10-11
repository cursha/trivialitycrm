// The fields the Missing Info report checks. Kept apart from
// missing-info.ts (server-only, queries the database) so the report's
// checkboxes in the browser can use the same list.

export const MISSING_FIELDS = ["phone", "websiteUrl", "email", "eosScore"] as const;
export type MissingField = (typeof MISSING_FIELDS)[number];

export const MISSING_FIELD_LABEL: Record<MissingField, string> = {
  phone: "Phone",
  websiteUrl: "Website",
  email: "Email",
  eosScore: "EOS",
};

/** The ticked fields from `?missing=phone,email`; none or junk = all four. */
export function parseMissingFields(value: string | undefined): MissingField[] {
  const picked = (value ?? "").split(",").filter((part): part is MissingField => (MISSING_FIELDS as readonly string[]).includes(part));
  return picked.length > 0 ? MISSING_FIELDS.filter((field) => picked.includes(field)) : [...MISSING_FIELDS];
}
