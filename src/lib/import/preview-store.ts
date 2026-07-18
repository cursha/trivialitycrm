import "server-only";
import crypto from "node:crypto";
import type { ParsedSpreadsheet } from "./parse";

// Uploaded spreadsheets and their parsed rows are NEVER written to Postgres
// or disk (requirement 9) — they live here, in-process, for the lifetime of
// the upload -> mapping -> preview -> confirm flow, then expire. Consistent
// with the same single-process assumption as the search job runner
// (run-search.ts) — see MODULE_2_REPORT.md for the tradeoff.
const TTL_MS = 30 * 60 * 1000;

type StoredUpload = ParsedSpreadsheet & { expiresAt: number; uploadedById: string };

const store = new Map<string, StoredUpload>();

function sweepExpired() {
  const now = Date.now();
  for (const [key, value] of store) {
    if (value.expiresAt < now) store.delete(key);
  }
}

export function putUpload(uploadedById: string, parsed: ParsedSpreadsheet): string {
  sweepExpired();
  const sessionId = crypto.randomUUID();
  store.set(sessionId, { ...parsed, uploadedById, expiresAt: Date.now() + TTL_MS });
  return sessionId;
}

export function getUpload(sessionId: string, uploadedById: string): ParsedSpreadsheet | undefined {
  sweepExpired();
  const entry = store.get(sessionId);
  if (!entry || entry.uploadedById !== uploadedById) return undefined;
  return { headers: entry.headers, rows: entry.rows };
}

export function clearUpload(sessionId: string): void {
  store.delete(sessionId);
}
