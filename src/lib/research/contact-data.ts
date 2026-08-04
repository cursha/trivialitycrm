import type { ContactDataEntry } from "./providers/types";

/**
 * SearchResult.contactData is a Json? column. Before Competition Locator,
 * every writer stored at most one contact as a bare object; new writers
 * (COMPETITOR-mode discovery) store an array of however many contacts were
 * found. This normalizes any of null / a legacy single object / an array
 * into an array, so every read site can treat the shape uniformly without a
 * data migration. Malformed/unexpected JSON reads as no contacts, never a
 * guess — the caller decides whether that's user-facing.
 */
export function readContactDataEntries(raw: unknown): ContactDataEntry[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.filter((entry): entry is ContactDataEntry => isContactDataEntry(entry));
  return isContactDataEntry(raw) ? [raw] : [];
}

function isContactDataEntry(value: unknown): value is ContactDataEntry {
  return typeof value === "object" && value !== null;
}
