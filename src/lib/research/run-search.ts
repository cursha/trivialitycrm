import "server-only";
import { prisma } from "@/lib/prisma";
import { getProviders } from "./providers/factory";
import { filterByModeExclusivity, dedupeWithinRun } from "./exclusivity";
import { computeNormalizedFields, findPriorRejectedMatches } from "@/lib/duplicates/match";
import type { DiscoverParams } from "./providers/types";

/**
 * Executes one LeadSearch end-to-end: discovery -> mode exclusivity ->
 * per-candidate verification + scoring -> rejection-memory check ->
 * SearchResult rows, updating job-status fields as it goes. Kicked off via
 * after() from the startSearch action (see leads/searches/actions.ts) — see
 * MODULE_2_REPORT.md for why this single-process design fits the current
 * self-hosted deployment and where it would need to change for a
 * multi-instance one.
 */
export async function runSearchJob(searchId: string): Promise<void> {
  const search = await prisma.leadSearch.findUniqueOrThrow({
    where: { id: searchId },
    include: { leadType: true, competitor: true },
  });

  await prisma.leadSearch.update({
    where: { id: searchId },
    data: { status: "RUNNING", startedAt: new Date(), heartbeatAt: new Date() },
  });

  try {
    const providers = getProviders();
    const cities = Array.isArray(search.cities) ? (search.cities as unknown[]).map((city) => String(city)) : [];

    const params: DiscoverParams = {
      promptText: search.promptSnapshot,
      country: search.country,
      region: search.region,
      cities,
      leadTypeName: search.leadType.name,
      mode: search.mode,
      competitorName: search.competitor?.name,
    };

    const rawCandidates = await providers.discovery.discover(params);
    const scoped = dedupeWithinRun(filterByModeExclusivity(rawCandidates, search.mode));

    let candidatesFound = 0;

    for (const rawCandidate of scoped) {
      const verified = await providers.verification.verify(rawCandidate, params);
      const { score, explanation } = await providers.scoring.score(verified, params);

      const priorRejections = await findPriorRejectedMatches(prisma, {
        name: verified.name,
        address1: verified.address1,
        city: verified.city,
        region: verified.region,
        postalCode: verified.postalCode,
        country: verified.country,
        websiteUrl: verified.websiteUrl,
        phone: verified.phone,
        email: verified.email,
      });

      const disposition = priorRejections.length > 0 ? "REJECTED" : score < search.minimumScore ? "BELOW_SCORE" : "NEW";

      const normalized = computeNormalizedFields({
        name: verified.name,
        phone: verified.phone,
        email: verified.email,
        websiteUrl: verified.websiteUrl,
      });

      let competitorId: string | null = null;
      if (verified.competitorName) {
        const matchedCompetitor = await prisma.competitor.findUnique({ where: { name: verified.competitorName } });
        competitorId = matchedCompetitor?.id ?? null;
      }

      await prisma.searchResult.create({
        data: {
          searchId,
          name: verified.name,
          address1: verified.address1,
          city: verified.city,
          region: verified.region,
          postalCode: verified.postalCode,
          country: verified.country,
          phone: verified.phone,
          email: verified.email,
          websiteUrl: verified.websiteUrl,
          contactData: verified.contactData ?? undefined,
          score,
          explanation:
            priorRejections.length > 0
              ? `${explanation}\n\n[Auto-rejected: matches a previously rejected location — use "restore" to reconsider.]`
              : explanation,
          evidence: verified.evidence,
          sources: verified.sources,
          triviaStatus: verified.triviaStatus,
          disposition,
          competitorId,
          ...normalized,
        },
      });

      candidatesFound += 1;
      await prisma.leadSearch.update({
        where: { id: searchId },
        data: { candidatesFound, heartbeatAt: new Date() },
      });
    }

    await prisma.leadSearch.update({
      where: { id: searchId },
      data: { status: "SUCCEEDED", completedAt: new Date(), heartbeatAt: new Date() },
    });
  } catch (error) {
    await prisma.leadSearch.update({
      where: { id: searchId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        heartbeatAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unknown error running the search.",
      },
    });
  }
}
