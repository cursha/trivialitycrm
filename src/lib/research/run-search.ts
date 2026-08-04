// No `import "server-only"` and only relative imports — this module now runs
// exclusively in the worker (worker/handlers/run-search.ts), under plain
// tsx, not inside the Next.js server. See src/lib/prisma.ts for the same
// pattern/reasoning.
import { prisma } from "../prisma";
import { getProviders } from "./providers/factory";
import { filterByModeExclusivity, dedupeWithinRun } from "./exclusivity";
import { computeNormalizedFields, findPriorRejectedMatches } from "../duplicates/match";
import { normalizeCompanyName } from "../duplicates/normalize";
import { normalizeRegion } from "../data-quality/normalize";
import { findScoredDuplicateMatches } from "../duplicates/scored-match";
import { stampEvidenceVerificationDates, hasCurrentVerifiedEvidence } from "./result-explanation";
import { getAiSettings, checkMidRunAiBudget } from "../ai/budget";
import { writeAuditEvent } from "../audit/log";
import { classifyProviderError } from "../integrations/provider-errors";
import type { DiscoverParams, ResearchCandidate, DiscoveryProgressUpdate } from "./providers/types";

// Competition Locator's verification-standard rejection reasons (seeded in
// prisma/seed.ts). Looked up once by name, not hardcoded ids, matching the
// rest of this app's "resolve by name/key" convention. COMPETITOR mode only
// — see the three checks in processCandidate() below.
const COMPETITOR_REJECTION_REASON_NAMES = {
  outsideRegion: "Outside Requested Country/Region",
  wrongProvider: "Different Trivia Provider",
  insufficientEvidence: "Insufficient Verifiable Evidence",
} as const;

function normalizeCountry(country: string): string {
  return country.trim().toLowerCase();
}

/**
 * Wraps a single provider call (discover/verify/score) so any raw error it
 * throws — a live Anthropic 5xx/overload, a rate limit, a timeout, etc. —
 * is sanitized through the same classifyProviderError() every other
 * AI/email call site in the app already uses, before it can reach
 * LeadSearch.errorMessage (shown directly to the user on the search status
 * page). Previously this file's outer catch stored `error.message` as-is,
 * so a raw provider error (confirmed live: Anthropic's 529 "overloaded"
 * response) would surface its full raw text to the user instead of a safe,
 * generic message. Deliberately NOT applied to the whole function — the
 * mid-run budget-block Error thrown below already carries its own safe,
 * specific message and must reach the user unchanged, not get flattened
 * into classifyProviderError's generic "unknown" fallback.
 */
async function callProviderSafely<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(classifyProviderError(error).safeMessage);
  }
}

function candidateIdentity(candidate: { name: string; city: string }): string {
  return `${normalizeCompanyName(candidate.name)}|${candidate.city.trim().toLowerCase()}`;
}

// Module Ten: candidates within one search are now verified/scored in
// batches of this size rather than strictly one-at-a-time — a real,
// production-incident-driven fix (see MODULE_10_REPORT.md), not a cosmetic
// one. Each candidate's own verify->score sequence is still fully
// sequential (scoring needs that candidate's own verified evidence), but
// different candidates' sequences now overlap. 3 is deliberately
// conservative: comfortably inside callProvider()'s shared 30-calls/minute
// rate limit per provider name, and small enough that a mid-batch budget
// breach (see below) only ever overshoots by a bounded, small amount.
const CANDIDATE_CONCURRENCY = 3;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
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

  // Competition Locator's verification-standard rejection reasons, resolved
  // once per job run (not per candidate) — only needed for COMPETITOR mode.
  let competitorRejectionReasonIds: Record<keyof typeof COMPETITOR_REJECTION_REASON_NAMES, string | null> = {
    outsideRegion: null,
    wrongProvider: null,
    insufficientEvidence: null,
  };
  if (search.mode === "COMPETITOR") {
    const reasons = await prisma.rejectionReason.findMany({
      where: { name: { in: Object.values(COMPETITOR_REJECTION_REASON_NAMES) } },
    });
    const byName = new Map(reasons.map((r) => [r.name, r.id]));
    competitorRejectionReasonIds = {
      outsideRegion: byName.get(COMPETITOR_REJECTION_REASON_NAMES.outsideRegion) ?? null,
      wrongProvider: byName.get(COMPETITOR_REJECTION_REASON_NAMES.wrongProvider) ?? null,
      insufficientEvidence: byName.get(COMPETITOR_REJECTION_REASON_NAMES.insufficientEvidence) ?? null,
    };
  }

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
      const cityCount = Math.max(cities.length, 1);
      await prisma.leadSearch.update({
        where: { id: searchId },
        data: {
          status: "RUNNING",
          startedAt: search.startedAt ?? new Date(),
          heartbeatAt: new Date(),
          // Otherwise the status page shows nothing at all until the FIRST
          // city finishes (which, for a single-city or slow-paginating
          // search, could be the entire run) — this gives it something to
          // show from the very first poll.
          progressMessage: `Starting search across ${cityCount} ${cityCount === 1 ? "city" : "cities"}...`,
        },
      });

      // Live "what's happening" text for the status page — otherwise a
      // multi-city GENERAL search shows nothing at all until this whole
      // discover() call returns, since candidatesFound doesn't update until
      // the bulk checkpoint transaction below. Cheap, best-effort: never
      // lets a progress-write failure fail the actual search.
      const onDiscoveryProgress = async (update: DiscoveryProgressUpdate) => {
        try {
          const progressMessage =
            update.kind === "city"
              ? `Searched ${update.city} (${update.cityIndex + 1}/${update.totalCities}) — ${update.foundSoFar} found so far.`
              : update.message;
          await prisma.leadSearch.update({
            where: { id: searchId },
            data: { progressMessage, heartbeatAt: new Date() },
          });
        } catch {
          // Best-effort — never let a progress-write failure fail the search.
        }
      };

      const rawCandidates = await callProviderSafely(() => providers.discovery.discover(params, onDiscoveryProgress));
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
        // Prisma's array-form $transaction defaults to a 5s timeout — fine
        // for a handful of candidates, but a real live search with a good,
        // specific prompt (unlike the earlier bracket-template one) can
        // discover enough candidates that bulk-checkpointing them all here
        // genuinely exceeds 5s. Confirmed live: "A commit cannot be
        // executed on an expired transaction... 5505 ms passed since the
        // start." 30s comfortably covers even the app's own upper bound
        // (maxResultsPerSearch/maxCitiesPerSearch), and this is a bulk
        // checkpoint step, not a fast interactive one.
        { timeout: 30_000 },
      );
    } else {
      await prisma.leadSearch.update({
        where: { id: searchId },
        data: { status: "RUNNING", heartbeatAt: new Date() },
      });
    }

    // --- Per-candidate processing, resumable at whichever stage wasn't
    // checkpointed on a prior attempt. Batched (see CANDIDATE_CONCURRENCY
    // above), not a single sequential loop — different candidates' own
    // verify->score sequences now run concurrently within each batch.
    // -----------------------------------------------------------------
    const candidateRows = await prisma.searchCandidate.findMany({
      where: { searchId, status: { not: "COMPLETED" } },
      orderBy: { index: "asc" },
    });

    async function processCandidate(candidateRow: (typeof candidateRows)[number]): Promise<void> {
      // Module Nine: rechecked before every candidate's own paid call, not
      // just once before the search started or once per batch — a search
      // that crosses the daily/monthly budget or its own maxCostPerSearchUsd
      // ceiling partway through stops here, before placing another paid
      // verify/score call. Checked per-candidate (inside processCandidate,
      // not once per batch) specifically so batching candidates for
      // concurrency (see CANDIDATE_CONCURRENCY above) doesn't weaken this —
      // a batch-level-only check would only fire once per up-to-3
      // candidates, letting a breach mid-batch go uncaught until the next
      // batch entirely. GENERAL mode never places a paid call at all (see
      // below), so this recheck is skipped for it — a pure DB-cost-avoidance
      // short-circuit, not a safety gap.
      if (search.mode !== "GENERAL") {
        const midRunCheck = await checkMidRunAiBudget(search.id, { overrideSpendLimit: search.budgetOverride });
        if (!midRunCheck.allowed) {
          await writeAuditEvent({
            actorId: search.createdById,
            module: "ai-integration",
            action: "ai_search.budget_blocked",
            entityType: "LeadSearch",
            entityId: search.id,
            success: false,
            metadata: { reason: midRunCheck.reason },
          });
          throw new Error(midRunCheck.reason ?? "AI budget limit reached mid-run.");
        }
      }

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
          verified = await callProviderSafely(() => providers.verification.verify(raw, params));
          await prisma.searchCandidate.update({
            where: { id: candidateRow.id },
            data: { status: "VERIFIED", verifiedData: verified as unknown as object },
          });
        } else {
          verified = (candidateRow.verifiedData as unknown as ResearchCandidate | null) ?? raw;
        }

        if (candidateRow.status === "PENDING" || candidateRow.status === "VERIFIED") {
          const scored = await callProviderSafely(() => providers.scoring.score(verified, params));
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

      // Competition Locator's verification-standard guards, COMPETITOR mode
      // only — every other mode's disposition/competitorId logic below is
      // completely untouched by this block.
      let competitorLocatorRejectionReasonId: string | null = null;
      let competitorLocatorRejectionNote: string | null = null;
      if (search.mode === "COMPETITOR") {
        verified = { ...verified, evidence: stampEvidenceVerificationDates(verified.evidence) };

        const searchedRegion = normalizeRegion(search.region, search.country);
        const candidateRegion = normalizeRegion(verified.region, verified.country);
        const searchedCountry = normalizeCountry(search.country);
        const candidateCountry = normalizeCountry(verified.country);

        if (candidateCountry !== searchedCountry || (searchedRegion && candidateRegion !== searchedRegion)) {
          competitorLocatorRejectionReasonId = competitorRejectionReasonIds.outsideRegion;
          competitorLocatorRejectionNote = "[Auto-rejected: outside the requested country/region.]";
        } else if (!hasCurrentVerifiedEvidence(verified.evidence)) {
          competitorLocatorRejectionReasonId = competitorRejectionReasonIds.insufficientEvidence;
          competitorLocatorRejectionNote = "[Auto-rejected: no current, verified evidence with a source citing this competitor.]";
        }
        // Wrong-provider check happens after competitorId is resolved below,
        // since it needs the same normalized-name comparison either way.
      }

      // Unresearched GENERAL-mode candidates carry a placeholder score of 0,
      // which is meaningless against minimumScore — sorting them into
      // BELOW_SCORE would hide every freshly-discovered business from the
      // default results view before anyone had a chance to research them.
      let disposition: "REJECTED" | "NEW" | "BELOW_SCORE" =
        priorRejections.length > 0 ? "REJECTED" : search.mode === "GENERAL" ? "NEW" : score < search.minimumScore ? "BELOW_SCORE" : "NEW";
      let finalExplanation =
        priorRejections.length > 0
          ? `${explanation}\n\n[Auto-rejected: matches a previously rejected location — use "restore" to reconsider.]`
          : explanation;
      let rejectionReasonId: string | null = null;

      if (competitorLocatorRejectionReasonId && disposition !== "REJECTED") {
        disposition = "REJECTED";
        rejectionReasonId = competitorLocatorRejectionReasonId;
        finalExplanation = `${explanation}\n\n${competitorLocatorRejectionNote}`;
      }

      const normalized = computeNormalizedFields({
        name: verified.name,
        phone: verified.phone,
        email: verified.email,
        websiteUrl: verified.websiteUrl,
      });

      // Existing behavior (every mode): trust whatever Competitor name the
      // provider returned, if any matches by exact name.
      //
      // COMPETITOR mode gets a real fix on top of that: today, a candidate
      // whose returned competitorName happens to equal a DIFFERENT
      // Competitor row than the one actually being searched for was
      // silently attributed to that other competitor instead of being
      // rejected — a pre-existing gap, not new-feature-only behavior. Now,
      // for COMPETITOR mode, only an exact (case/whitespace-normalized)
      // match against the searched-for competitor's own name is trusted;
      // anything else is rejected as "Different Trivia Provider" rather than
      // silently mis-attributed or silently dropped.
      let competitorId: string | null = null;
      if (verified.competitorName) {
        if (search.mode === "COMPETITOR" && search.competitor) {
          const matches = verified.competitorName.trim().toLowerCase() === search.competitor.name.trim().toLowerCase();
          if (matches) {
            competitorId = search.competitor.id;
          } else if (disposition !== "REJECTED") {
            disposition = "REJECTED";
            rejectionReasonId = competitorRejectionReasonIds.wrongProvider;
            finalExplanation = `${explanation}\n\n[Auto-rejected: evidence points to a different trivia provider ("${verified.competitorName}").]`;
          }
        } else {
          const matchedCompetitor = await prisma.competitor.findUnique({ where: { name: verified.competitorName } });
          competitorId = matchedCompetitor?.id ?? null;
        }
      }

      // Competition Locator: confidence-tiered duplicate matching against
      // existing companies, computed once here (not recomputed on every
      // review-page load) — skipped for already-rejected rows, which never
      // reach the review screen's duplicate/conflict buckets anyway.
      let duplicateMatches: Awaited<ReturnType<typeof findScoredDuplicateMatches>> = [];
      let duplicateConfidence: "HIGH" | "MEDIUM" | "LOW" | null = null;
      let competitorConflict = false;
      if (search.mode === "COMPETITOR" && disposition !== "REJECTED") {
        duplicateMatches = await findScoredDuplicateMatches(prisma, {
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
        const topMatch = duplicateMatches[0];
        if (topMatch) {
          duplicateConfidence = topMatch.confidence;
          const topCompany = await prisma.company.findUnique({ where: { id: topMatch.companyId }, select: { competitorId: true } });
          competitorConflict = !!topCompany?.competitorId && topCompany.competitorId !== competitorId;
        }
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
          rejectionReasonId,
          competitorId,
          duplicateMatches: duplicateMatches.length > 0 ? duplicateMatches : undefined,
          duplicateConfidence,
          competitorConflict,
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

    for (const batch of chunk(candidateRows, CANDIDATE_CONCURRENCY)) {
      if (options.isCancelled && (await options.isCancelled())) return;

      // Visible proof-of-life for the per-candidate phase, same idiom as
      // onDiscoveryProgress above — named venues currently being processed,
      // not a synthetic timer, so a long-running search never goes quiet
      // and indistinguishable from a stuck one.
      try {
        const batchNames = batch.map((row) => {
          const raw = row.rawCandidate as unknown as ResearchCandidate;
          return `${raw.name} (${raw.city})`;
        });
        await prisma.leadSearch.update({
          where: { id: searchId },
          data: {
            progressMessage: `Processing ${batchNames.join(", ")}...`,
            heartbeatAt: new Date(),
          },
        });
      } catch {
        // Best-effort — never let a progress-write failure fail the search.
      }

      // allSettled, not all — every candidate in this batch must be allowed
      // to fully finish (reach COMPLETED, with its SearchResult written)
      // even if a sibling candidate in the same batch fails. Promise.all
      // would reject as soon as the FIRST candidate throws, abandoning the
      // others mid-flight as orphaned, un-awaited promises — their DB
      // writes would then race against this function's own catch block
      // (and the worker potentially moving on to the next job) instead of
      // being guaranteed to land. allSettled waits for the whole batch,
      // so by the time a failure is thrown below, every other candidate in
      // the batch is already fully checkpointed one way or the other —
      // matching the resumability guarantee the sequential version had.
      const outcomes = await Promise.allSettled(batch.map((candidateRow) => processCandidate(candidateRow)));
      const firstFailure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      if (firstFailure) throw firstFailure.reason;
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
