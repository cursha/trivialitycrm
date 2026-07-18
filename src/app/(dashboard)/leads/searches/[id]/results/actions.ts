"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";

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
