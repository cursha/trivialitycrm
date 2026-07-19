import "server-only";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import type { ParsedSpreadsheet } from "./parse";

/**
 * Durable, database-backed replacement for the old in-memory upload preview
 * store (a bare module-level Map — lost on every restart/redeploy, and not
 * shared across instances). `payload` is nulled the moment it's no longer
 * needed: immediately on a successful commit (see markImported, called
 * inside the same transaction as the Company/Contact writes it produces) or
 * by the worker's cleanup cron once expiresAt passes for a batch nobody
 * ever committed. Stored as plain Json, not application-layer encrypted —
 * see MODULE_3_REPORT.md for why (Company/Contact, the destination this
 * data becomes seconds later, already store the same PII as plain columns;
 * protection is Postgres TLS in transit, disk encryption at rest, and the
 * uploadedById ownership check below, same as the store it replaces).
 */

export async function putUpload(uploadedById: string, filename: string, parsed: ParsedSpreadsheet): Promise<string> {
  const ttlHours = getEnv().IMPORT_BATCH_TTL_HOURS;
  const batch = await prisma.importBatch.create({
    data: {
      uploadedById,
      filename,
      headers: parsed.headers as unknown as Prisma.InputJsonValue,
      payload: parsed.rows as unknown as Prisma.InputJsonValue,
      rowCount: parsed.rows.length,
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
    },
  });
  return batch.id;
}

/** Returns undefined for a missing batch, a different uploader, an expired batch, or one
 * whose payload has already been cleared (committed or previously expired) — the caller
 * can't distinguish these cases and shouldn't need to; they're all "start over." */
export async function getUpload(batchId: string, uploadedById: string): Promise<ParsedSpreadsheet | undefined> {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return undefined;
  if (batch.uploadedById !== uploadedById) return undefined;
  if (batch.payload === null) return undefined;
  if (batch.expiresAt.getTime() < Date.now()) return undefined;
  return { headers: batch.headers as unknown as string[], rows: batch.payload as unknown as Record<string, string>[] };
}

/** Opportunistic, for admin visibility only — the mapping actually used is still passed
 * explicitly to previewImport/commitImport on every call, this just records the last one. */
export async function recordMapping(batchId: string, mapping: Record<string, string>): Promise<void> {
  await prisma.importBatch
    .update({ where: { id: batchId }, data: { mapping: mapping as unknown as Prisma.InputJsonValue, status: "CONFIRMED" } })
    .catch(() => {});
}

/** Wipes the staged payload and marks a batch imported. Must be called with the
 * transaction client, inside the same transaction as the Company/Contact rows it produced —
 * so a crash between creating those rows and clearing the payload can't happen silently. */
export async function markImported(tx: Prisma.TransactionClient, batchId: string): Promise<void> {
  await tx.importBatch.update({ where: { id: batchId }, data: { payload: Prisma.DbNull, status: "IMPORTED" } });
}

/** Explicit abandon — not on the commit happy path (see markImported), used by the worker's
 * expiry sweep (worker/handlers/cleanup.ts) for batches nobody ever committed. */
export async function clearUpload(batchId: string): Promise<void> {
  await prisma.importBatch.update({ where: { id: batchId }, data: { payload: Prisma.DbNull, status: "EXPIRED" } }).catch(() => {});
}
