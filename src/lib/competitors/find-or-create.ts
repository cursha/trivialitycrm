import type { AppTransactionClient, AppPrismaClient } from "@/lib/prisma";

/**
 * Resolves a raw provider name (as found by AI research/analysis) to a
 * tracked Competitor row — matching by exact, case-insensitive name first,
 * creating one only when nothing matches. Both analyze-opportunity.ts and
 * run-search.ts need this same resolution so that Company.competitorId
 * always gets linked whenever a provider name is found, never left orphaned
 * just because the catalog didn't already contain it.
 *
 * name is unique on Competitor, so two concurrent callers finding the same
 * new name can race past the initial findFirst and both attempt create —
 * caught here (Prisma error code P2002) by re-reading the row the other
 * request just inserted, rather than surfacing a spurious failure.
 */
export async function findOrCreateCompetitor(client: AppPrismaClient | AppTransactionClient, name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();
  const existing = await findCompetitorByName(client, trimmed);
  if (existing) return existing;

  try {
    return await client.competitor.create({ data: { name: trimmed } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const raceWinner = await client.competitor.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
      if (raceWinner) return raceWinner;
    }
    throw error;
  }
}

/** The same exact, case-insensitive name match, without creating anything —
 * for the spreadsheet import, which only links a provider name to a
 * Competitor already being tracked. */
export async function findCompetitorByName(client: AppPrismaClient | AppTransactionClient, name: string): Promise<{ id: string; name: string } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return client.competitor.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } }, select: { id: true, name: true } });
}
