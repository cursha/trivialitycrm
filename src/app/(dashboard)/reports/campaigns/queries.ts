import "server-only";
import { prisma } from "@/lib/prisma";
import { salesListVisibilityWhere } from "@/lib/sales-lists/scope";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import type { Prisma } from "@/generated/prisma/client";

export type CampaignReportFilters = {
  listId?: string;
  status?: string;
  senderId?: string;
  createdFrom?: string;
  createdTo?: string;
  /** Recipient-level outcome (CampaignRecipientStatus) — narrows the
   * breakdown tables to, e.g., only STOPPED_OPT_OUT recipients. */
  outcome?: string;
};

/** Every campaign this user's sales-list visibility covers (matches
 * listCampaigns' own scoping exactly — campaign reporting visibility rides
 * on the same private/shared-team/shared-users rules as the campaign
 * feature itself, not a separate reporting-scope tier), narrowed by the
 * report's own filters. */
export async function getCampaignsForReport(user: AuthenticatedUser, filters: CampaignReportFilters) {
  const listScope = salesListVisibilityWhere(user);
  if (!listScope) return [];

  const where: Prisma.CampaignWhereInput = { list: listScope };
  if (filters.listId) where.listId = filters.listId;
  if (filters.status) where.status = filters.status as Prisma.EnumCampaignStatusFilter["equals"];
  if (filters.senderId) where.senderId = filters.senderId;
  if (filters.createdFrom || filters.createdTo) {
    where.createdAt = {
      ...(filters.createdFrom ? { gte: new Date(filters.createdFrom) } : {}),
      ...(filters.createdTo ? { lte: new Date(filters.createdTo) } : {}),
    };
  }

  const campaigns = await prisma.campaign.findMany({
    where,
    include: {
      list: true,
      sender: true,
      recipients: { select: { status: true, stepRuns: { select: { status: true } } } },
      _count: { select: { recipients: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return campaigns.map((campaign) => {
    const allRuns = campaign.recipients.flatMap((r) => r.stepRuns);
    return {
      ...campaign,
      sentCount: allRuns.filter((r) => r.status === "SENT").length,
      failedCount: allRuns.filter((r) => r.status === "FAILED").length,
    };
  });
}

/** Aggregate recipient-outcome counts by lead type, location, and pipeline
 * stage across every campaign visible to this user (optionally narrowed to
 * one campaign) — the spec's "campaign reporting filters ... lead type,
 * location, stage, outcome." */
export async function getCampaignOutcomeBreakdown(user: AuthenticatedUser, filters: CampaignReportFilters) {
  const listScope = salesListVisibilityWhere(user);
  if (!listScope) return { byLeadType: [], byStage: [], byLocation: [], byOutcome: [] };

  const campaignWhere: Prisma.CampaignWhereInput = { list: listScope };
  if (filters.listId) campaignWhere.listId = filters.listId;
  if (filters.status) campaignWhere.status = filters.status as Prisma.EnumCampaignStatusFilter["equals"];
  if (filters.senderId) campaignWhere.senderId = filters.senderId;

  const recipients = await prisma.campaignRecipient.findMany({
    where: { campaign: campaignWhere, ...(filters.outcome ? { status: filters.outcome as Prisma.EnumCampaignRecipientStatusFilter["equals"] } : {}) },
    select: {
      status: true,
      company: { select: { city: true, region: true, pipelineStageId: true, leadTypeId: true, leadType: { select: { name: true } }, pipelineStage: { select: { name: true } } } },
    },
  });

  return {
    byLeadType: groupCount(recipients, (r) => r.company.leadType.name),
    byStage: groupCount(recipients, (r) => r.company.pipelineStage?.name ?? "(no stage)"),
    byLocation: groupCount(recipients, (r) => [r.company.city, r.company.region].filter(Boolean).join(", ") || "(no location)"),
    byOutcome: groupCount(recipients, (r) => r.status),
  };
}

function groupCount<T>(rows: T[], keyFor: (row: T) => string): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
