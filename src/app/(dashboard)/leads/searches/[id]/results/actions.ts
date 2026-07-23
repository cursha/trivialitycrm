"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { checkAiBudget } from "@/lib/ai/budget";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { getProviders } from "@/lib/research/providers/factory";
import type { DiscoverParams, ResearchCandidate } from "@/lib/research/providers/types";
import { writeAuditEvent } from "@/lib/audit/log";

export type ResultActionResult = { error?: string } | undefined;

export async function rejectResult(id: string, rejectionReasonId: string): Promise<ResultActionResult> {
  const user = await requireUser();
  requirePermission(user, "review_research_results");

  const result = await prisma.searchResult.findUnique({ where: { id } });
  if (!result) return { error: "Result not found." };

  await prisma.searchResult.update({ where: { id }, data: { disposition: "REJECTED", rejectionReasonId } });
  revalidatePath(`/leads/searches/${result.searchId}/results`);
}

export async function restoreResult(id: string): Promise<ResultActionResult> {
  const user = await requireUser();
  requirePermission(user, "restore_rejected");

  const result = await prisma.searchResult.findUnique({ where: { id }, include: { search: true } });
  if (!result) return { error: "Result not found." };

  await prisma.searchResult.update({
    where: { id },
    data: {
      disposition: result.score >= result.search.minimumScore ? "REVIEWED" : "BELOW_SCORE",
      rejectionReasonId: null,
    },
  });
  revalidatePath(`/leads/searches/${result.searchId}/results`);
}

export async function markReviewed(id: string): Promise<ResultActionResult> {
  const user = await requireUser();
  requirePermission(user, "review_research_results");

  const result = await prisma.searchResult.findUnique({ where: { id } });
  if (!result) return { error: "Result not found." };
  if (result.disposition !== "NEW") return undefined;

  await prisma.searchResult.update({ where: { id }, data: { disposition: "REVIEWED" } });
  revalidatePath(`/leads/searches/${result.searchId}/results`);
}

/**
 * The opt-in AI deep-dive for one already-discovered result — "if I'm
 * interested in this one, pull the records." Runs the existing verify()/
 * score() AI step (same code the old fully-automatic pipeline used per
 * candidate) but scoped to just this row, triggered manually, so AI spend
 * is proportional to actual interest rather than automatic for every
 * directory-sourced candidate. Deliberately synchronous (no job queue) —
 * a single verify() call measures 20-90s in practice, tolerable for a
 * manually-triggered single-row action with a loading state, and this
 * avoids adding another retry policy that could multiply cost the way the
 * old discover()-per-search pipeline did.
 *
 * Deliberately only updates the AI-derived fields (triviaStatus, evidence,
 * sources, score, explanation) — never name/address/phone/email/website,
 * even if the AI response includes different values for them. Contact
 * fields from a directory provider are already reliable; this action exists
 * to answer the trivia-status question, not to second-guess good directory
 * data with a possibly-imperfect AI guess.
 */
export async function researchResult(id: string): Promise<ResultActionResult> {
  const user = await requireUser();
  requirePermission(user, "run_research");

  const budgetCheck = await checkAiBudget();
  if (!budgetCheck.allowed) return { error: budgetCheck.reason };

  const rateLimit = await checkRateLimit(`research-result:${user.id}`, { windowMs: 60_000, limit: 5 });
  if (!rateLimit.allowed) return { error: "Too many research requests — wait a moment and try again." };

  const result = await prisma.searchResult.findUnique({
    where: { id },
    include: { search: { include: { leadType: true, competitor: true } }, competitor: true },
  });
  if (!result) return { error: "Result not found." };

  const candidate: ResearchCandidate = {
    name: result.name,
    address1: result.address1,
    city: result.city,
    region: result.region,
    postalCode: result.postalCode,
    country: result.country,
    phone: result.phone,
    email: result.email,
    websiteUrl: result.websiteUrl,
    contactData: result.contactData as ResearchCandidate["contactData"],
    triviaStatus: result.triviaStatus,
    competitorName: result.competitor?.name ?? null,
    evidence: result.evidence as ResearchCandidate["evidence"],
    sources: result.sources as ResearchCandidate["sources"],
  };

  const params: DiscoverParams = {
    promptText: result.search.promptSnapshot,
    country: result.search.country,
    region: result.search.region,
    cities: [result.city],
    leadTypeName: result.search.leadType.name,
    mode: result.search.mode,
    competitorName: result.search.competitor?.name,
    searchId: result.search.id,
    userId: user.id,
  };

  const providers = getProviders(result.search.mode);
  const verified = await providers.verification.verify(candidate, params);
  const scored = await providers.scoring.score(verified, params);

  // Only recompute disposition from a still-active state — never silently
  // un-reject or un-transfer a row the user (or the transfer flow) already
  // made a final decision on.
  let disposition = result.disposition;
  if (disposition === "NEW" || disposition === "REVIEWED" || disposition === "BELOW_SCORE") {
    disposition = scored.score >= result.search.minimumScore ? "REVIEWED" : "BELOW_SCORE";
  }

  await prisma.searchResult.update({
    where: { id },
    data: {
      triviaStatus: verified.triviaStatus,
      evidence: verified.evidence,
      sources: verified.sources,
      score: scored.score,
      explanation: scored.explanation,
      disposition,
      researchedAt: new Date(),
    },
  });

  await writeAuditEvent({
    actorId: user.id,
    module: "research",
    action: "result.researched",
    entityType: "SearchResult",
    entityId: id,
    beforeData: { triviaStatus: result.triviaStatus, score: result.score },
    afterData: { triviaStatus: verified.triviaStatus, score: scored.score },
  });

  revalidatePath(`/leads/searches/${result.searchId}/results`);
}
