import "server-only";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "../../generated/prisma/client";

/**
 * The "sweet spot": bars most likely to buy a self-run trivia game. Not a
 * filter-out — every other bar is still worth working, just less likely
 * (Curt's call: "the perfect bar is never out, it's just not likely"). The
 * very best trivia venues usually buy hosted trivia, or head office decides
 * for them; the sweet spot is the independent bar with a decent, not
 * perfect, Entertainment Opportunity Score.
 *
 * A bar is in the sweet spot when all of these hold:
 * - independent: its name isn't shared by CHAIN_MIN_LOCATIONS+ active
 *   companies in the CRM
 * - no hosted trivia on file (trivia status isn't Current Trivia, no
 *   competitor linked or found)
 * - TVs not confirmed missing
 * - EOS from MIN_EOS to MAX_EOS (unscored bars aren't judged)
 */
export const SWEET_SPOT = { MIN_EOS: 60, MAX_EOS: 89, CHAIN_MIN_LOCATIONS: 3 } as const;

export type LikelihoodFields = {
  normalizedName: string;
  eosScore: number | null;
  hasTvs: boolean | null;
  triviaStatus: string;
  competitorId: string | null;
  competitorTriviaProvider: string | null;
};

export type Likelihood = { sweetSpot: boolean; lessLikelyBecause: string[] };

/** Normalized names shared by enough active companies to count as a chain,
 * with how many locations each has. */
export async function getChainNames(): Promise<Map<string, number>> {
  const groups = await prisma.company.groupBy({
    by: ["normalizedName"],
    where: { status: "ACTIVE" },
    _count: { _all: true },
    having: { normalizedName: { _count: { gte: SWEET_SPOT.CHAIN_MIN_LOCATIONS } } },
  });
  return new Map(groups.map((group) => [group.normalizedName, group._count._all]));
}

/** Whether a bar is in the sweet spot, and if not, the plain reasons it's
 * less likely (never a "no"). */
export function assessLikelihood(company: LikelihoodFields, chainNames: Map<string, number>): Likelihood {
  const reasons: string[] = [];
  const locations = chainNames.get(company.normalizedName);
  if (locations) reasons.push(`Part of a chain (${locations} locations in the CRM): head office often decides`);
  if (company.triviaStatus === "CURRENT_TRIVIA" || company.competitorId || company.competitorTriviaProvider) {
    reasons.push(company.competitorTriviaProvider ? `Already runs trivia with ${company.competitorTriviaProvider}` : "Already runs trivia");
  }
  if (company.hasTvs === false) reasons.push("No TVs confirmed");
  if (company.eosScore === null) {
    reasons.push("Not scored yet");
  } else if (company.eosScore > SWEET_SPOT.MAX_EOS) {
    reasons.push(`A top-scoring venue (EOS ${company.eosScore}): these often buy hosted trivia`);
  } else if (company.eosScore < SWEET_SPOT.MIN_EOS) {
    reasons.push(`EOS ${company.eosScore} is under ${SWEET_SPOT.MIN_EOS}: a weaker fit`);
  }
  return { sweetSpot: reasons.length === 0, lessLikelyBecause: reasons };
}

/** The same rule as a database filter, for "Sweet spot only" lists. */
export function sweetSpotWhere(chainNames: Map<string, number>): Prisma.CompanyWhereInput {
  return {
    AND: [
      { eosScore: { gte: SWEET_SPOT.MIN_EOS, lte: SWEET_SPOT.MAX_EOS } },
      { OR: [{ hasTvs: true }, { hasTvs: null }] },
      { triviaStatus: { not: "CURRENT_TRIVIA" } },
      { competitorId: null },
      { competitorTriviaProvider: null },
      ...(chainNames.size > 0 ? [{ normalizedName: { notIn: [...chainNames.keys()] } }] : []),
    ],
  };
}
