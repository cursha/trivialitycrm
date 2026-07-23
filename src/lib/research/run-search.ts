// No `import "server-only"` and only relative imports — this module now runs
// exclusively in the worker (worker/handlers/run-search.ts), under plain
// tsx, not inside the Next.js server. See src/lib/prisma.ts for the same
// pattern/reasoning.
import { prisma } from "../prisma";
import { getProviders } from "./providers/factory";
import { filterByModeExclusivity, dedupeWithinRun } from "./exclusivity";
import { computeNormalizedFields, findPriorRejectedMatches } from "../duplicates/match";
import { normalizeCompanyName } from "../duplicates/normalize";
import { getAiSettings } from "../ai/budget";
import type { DiscoverParams, ResearchCandidate } from "./providers/types";

function candidateIdentity(candidate: { name: string; city: string }): string {
  return `${normalizeCompanyName(candidate.name)}|${candidate.city.trim().toLowerCase()}`;
}

export type RunSearchJobOptions = {
  /** Polled between candidates. A true result stops the job early without
   * touching LeadSearch.status — the cancel action itself is the one that
   * sets it to CANCELLED, this just stops further (billed) provider calls
   * once that's happened. */
  isCancelled?: () => Promise<boolean>;
};

/**
 * Executes one LeadSearch end-to-end: discovery -> mode exclusivity ->
 * per-candidate verification + scoring -> rejection-memory check ->
 * SearchResult rows, updating job-status fields as it goes.
 *
 * Safely resumable: every candidate returned by discover() is persisted as a
 * SearchCandidate row (keyed on [searchId, normalizedIdentity]) before any
 * further processing, and each candidate's progress (verified -> scored ->
 * completed) is checkpointed as it happens. A retried/resumed run (see
 * worker/handlers/run-search.ts, which wraps this with pg-boss's bounded
 * exponential-backoff retry) skips discover() entirely once candidates
 * exist, and skips every already-COMPLETED candidate, re-entering exactly at
 * the first un-checkpointed stage. SearchResult rows are upserted by
 * candidateId, so a resumed run can never create a duplicate result — see
 * MODULE_3_REPORT.md for the full idempotency design and its one inherent
 * limit (a crash in the narrow window between a provider call returning and
 * its result being checkpointed can redo that one call, bounded by the
 * queue's retryLimit, never unbounded).
 */
export async function runSearchJob(searchId: string, options: RunSearchJobOptions = {}): Promise<void> {
  const search = await prisma.leadSearch.findUniqueOrThrow({
    where: { id: searchId },
    include: { leadType: true, competitor: true },
  });

  // A cancelled search must never be resurrected by a retried/resumed job.
  if (search.status === "CANCELLED") return;

  try {
    const providers = getProviders(search.mode);
    const cities = Array.isArray(search.cities) ? (search.cities as unknown[]).map((city) => String(city)) : [];

    const params: DiscoverParams = {
      promptText: search.promptSnapshot,
      country: search.country,
      region: search.region,
      cities,
      leadTypeName: search.leadType.name,
      mode: search.mode,
      competitorName: search.competitor?.name,
      searchId: search.id,
      userId: search.createdById,
    };

    // --- Discovery checkpoint -------------------------------------------
    // discover() only ever runs once candidates haven't already been
    // persisted for this search. This is the sole point where a crash can
    // cause discover() to be called again (if the crash lands between the
    // response returning and the transaction below committing) — bounded by
    // the queue's retryLimit, and the upsert-by-normalizedIdentity keeps it
    // duplicate-free either way.
    const existingCandidateCount = await prisma.searchCandidate.count({ where: { searchId } });

    if (existingCandidateCount === 0) {
      await prisma.leadSearch.update({
        where: { id: searchId },
        data: { status: "RUNNING", startedAt: search.startedAt ?? new Date(), heartbeatAt: new Date() },
      });

      const rawCandidates = await providers.discovery.discover(params);
      const deduped = dedupeWithinRun(filterByModeExclusivity(rawCandidates, search.mode));

      // Module 8A: an administrator-configured cap (AiSettings.
      // maxResultsPerSearch, null = unlimited) — applied here, after
      // dedup/exclusivity filtering, not as a discover() parameter, so the
      // cap is enforced consistently regardless of what a given provider
      // implementation does or doesn't support natively.
      const { maxResultsPerSearch } = await getAiSettings();
      const scoped = maxResultsPerSearch !== null ? deduped.slice(0, maxResultsPerSearch) : deduped;

      await prisma.$transaction(
        scoped.map((candidate, index) =>
          prisma.searchCandidate.upsert({
            where: { searchId_normalizedIdentity: { searchId, normalizedIdentity: candidateIdentity(candidate) } },
            create: {
              searchId,
              index,
              normalizedIdentity: candidateIdentity(candidate),
              rawCandidate: candidate as unknown as object,
            },
            update: {},
          }),
        ),
      );
    } else {
      await prisma.leadSearch.update({
        where: { id: searchId },
        data: { status: "RUNNING", heartbeatAt: new Date() },
      });
    }

    // --- Per-candidate loop, resumable at whichever stage wasn't
    // checkpointed on a prior attempt --------------------------------------
    const candidateRows = await prisma.searchCandidate.findMany({
      where: { searchId, status: { not: "COMPLETED" } },
      orderBy: { index: "asc" },
    });

    for (const candidateRow of candidateRows) {
      if (options.isCancelled && (await options.isCancelled())) return;

      const raw = candidateRow.rawCandidate as unknown as ResearchCandidate;
      let verified: ResearchCandidate;
      let score: number;
      let explanation: string;

      if (search.mode === "GENERAL") {
        // Directory-sourced candidates never get an automatic AI verify/score
        // pass — that's the entire point of the discovery/research split
        // (see providers/google-places.ts and results/actions.ts#
        // researchResult): browsing a city's businesses stays fast, cheap,
        // and off the AI budget entirely. triviaStatus stays "UNCERTAIN" and
        // evidence/sources stay empty (as returned by the discovery
        // provider) until a user opts into "Research this business" on a
        // specific row.
        verified = raw;
        score = 0;
        explanation = 'Not yet researched — use "Research this business" for an AI-evaluated score and trivia status.';
        if (candidateRow.status !== "SCORED") {
          await prisma.searchCandidate.update({ where: { id: candidateRow.id }, data: { status: "SCORED", score, explanation } });
        }
      } else {
        if (candidateRow.status === "PENDING") {
          verified = await providers.verification.verify(raw, params);
          await prisma.searchCandidate.update({
            where: { id: candidateRow.id },
            data: { status: "VERIFIED", verifiedData: verified as unknown as object },
          });
        } else {
          verified = (candidateRow.verifiedData as unknown as ResearchCandidate | null) ?? raw;
        }

        if (candidateRow.status === "PENDING" || candidateRow.status === "VERIFIED") {
          const scored = await providers.scoring.score(verified, params);
          score = scored.score;
          explanation = scored.explanation;
          await prisma.searchCandidate.update({
            where: { id: candidateRow.id },
            data: { status: "SCORED", score, explanation },
          });
        } else {
          // SCORED already, resuming after a crash between scoring and result creation.
          score = candidateRow.score as number;
          explanation = candidateRow.explanation as string;
        }
      }

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

      // Unresearched GENERAL-mode candidates carry a placeholder score of 0,
      // which is meaningless against minimumScore — sorting them into
      // BELOW_SCORE would hide every freshly-discovered business from the
      // default results view before anyone had a chance to research them.
      const disposition =
        priorRejections.length > 0 ? "REJECTED" : search.mode === "GENERAL" ? "NEW" : score < search.minimumScore ? "BELOW_SCORE" : "NEW";
      const finalExplanation =
        priorRejections.length > 0
          ? `${explanation}\n\n[Auto-rejected: matches a previously rejected location — use "restore" to reconsider.]`
          : explanation;

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

      // Upsert, not create — a resumed run whose previous attempt reached
      // this point but crashed before marking the candidate COMPLETED must
      // not produce a second SearchResult row for the same candidate.
      await prisma.searchResult.upsert({
        where: { candidateId: candidateRow.id },
        create: {
          searchId,
          candidateId: candidateRow.id,
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
          explanation: finalExplanation,
          evidence: verified.evidence,
          sources: verified.sources,
          triviaStatus: verified.triviaStatus,
          disposition,
          competitorId,
          ...normalized,
        },
        update: {},
      });

      await prisma.searchCandidate.update({ where: { id: candidateRow.id }, data: { status: "COMPLETED" } });

      const candidatesFound = await prisma.searchCandidate.count({ where: { searchId, status: "COMPLETED" } });
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
    // Deliberately does NOT rethrow — this function always resolves, whether
    // the search succeeded or failed, recording the outcome in LeadSearch
    // itself either way. The pg-boss integration point
    // (worker/handlers/run-search.ts) re-derives failure from the persisted
    // status afterward rather than from an exception, so it can signal
    // pg-boss for retry/backoff purposes without this function's contract
    // needing to change for that caller. A retry re-enters this same
    // function, finds status FAILED, and proceeds exactly as a fresh RUNNING
    // attempt would (nothing above branches on FAILED specifically),
    // resuming from whatever was already checkpointed.
  }
}
