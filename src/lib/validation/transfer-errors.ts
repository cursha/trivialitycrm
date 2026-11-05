import type { TransferPayload } from "@/lib/validation/transfer";

/** Per-row field problems, keyed by resultId then field name. */
export type TransferFieldErrors = Record<string, Record<string, string>>;

/**
 * Turns validation problems into a message that names each company with a
 * bad field (a transfer can hold dozens of rows, and "Enter a valid postal
 * code" alone doesn't say which one), plus per-field notes the form shows on
 * that company's card.
 */
export function describeInvalidRows(
  issues: { path: PropertyKey[]; message: string }[],
  rawPayload: TransferPayload,
): { error: string; fieldErrors: TransferFieldErrors } {
  const fieldErrors: TransferFieldErrors = {};
  const names: string[] = [];
  let otherMessage: string | undefined;
  for (const issue of issues) {
    const [top, index, field] = issue.path;
    const row = top === "rows" && typeof index === "number" ? rawPayload.rows?.[index] : undefined;
    if (!row) {
      otherMessage ??= issue.message;
      continue;
    }
    const rowErrors = (fieldErrors[row.resultId] ??= {});
    if (typeof field === "string" && !rowErrors[field]) rowErrors[field] = issue.message;
    const name = row.name?.trim() || `Lead ${Number(index) + 1}`;
    if (!names.includes(name)) names.push(name);
  }
  if (names.length === 0) return { error: otherMessage ?? "Please correct the highlighted fields.", fieldErrors };
  const firstRowErrors = Object.values(fieldErrors)[0] ?? {};
  const firstMessage = Object.values(firstRowErrors)[0];
  const error =
    names.length === 1
      ? `${names[0]}: ${firstMessage ?? "please correct the highlighted fields."}`
      : `Fix the fields marked in red for ${names.length} leads: ${names.join(", ")}.`;
  return { error, fieldErrors };
}
