/**
 * FormData.get() returns `null` for an absent key, but our Zod schemas
 * treat `undefined` (not `null`) as "field not provided" for optional
 * fields — and a raw `null` fails even required-field checks with a
 * generic type-mismatch message instead of the schema's custom one. This
 * normalizes every read to a plain string, matching how a real browser
 * form always submits present-but-empty text inputs.
 */
export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
