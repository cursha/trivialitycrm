"use server";

import { requireUser } from "@/lib/auth/current-user";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { prisma } from "@/lib/prisma";
import { companyScope } from "@/lib/companies/scope";
import { MIN_QUERY_LENGTH } from "@/lib/search/global-search";

export type QuickAddOptions = {
  currentUserId: string;
  leadTypes: { id: string; name: string }[];
  pipelineStages: { id: string; name: string }[];
  defaultPipelineStageId: string | null;
};

/** Lazily fetched the first time Quick Add opens — not passed down through
 * every page's props, so pages that never open Quick Add never pay for
 * this query. */
export async function getQuickAddOptions(): Promise<QuickAddOptions> {
  const user = await requireUser();

  const [leadTypes, pipelineStages] = await Promise.all([
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, isDefault: true } }),
  ]);

  return {
    currentUserId: user.id,
    leadTypes,
    pipelineStages: pipelineStages.map((s) => ({ id: s.id, name: s.name })),
    defaultPipelineStageId: pipelineStages.find((s) => s.isDefault)?.id ?? null,
  };
}

export type QuickAddCompanyOption = { id: string; name: string; city: string; region: string };

/** A company-only lookup for the Contact/Note/Activity/Follow-up tabs,
 * which all need an existing company chosen first — same companyScope
 * enforcement and MERGED exclusion as globalSearch(), scoped down to just
 * companies since that's all these tabs need. */
export async function quickAddCompanySearch(query: string): Promise<QuickAddCompanyOption[]> {
  const user = await requireUser();
  if (query.trim().length < MIN_QUERY_LENGTH) return [];

  const rateLimit = await checkRateLimit(`global-search:${user.id}`, { windowMs: 10_000, limit: 30 });
  if (!rateLimit.allowed) return [];

  const scope = companyScope(user);
  if (!scope) return [];

  const contains = { contains: query.trim(), mode: "insensitive" as const };
  const companies = await prisma.company.findMany({
    where: { AND: [scope, { status: { not: "MERGED" } }, { name: contains }] },
    select: { id: true, name: true, city: true, region: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  return companies;
}
