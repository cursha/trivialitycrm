import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { companyScope } from "@/lib/companies/scope";
import type { Prisma } from "@/generated/prisma/client";
import { TriviaStatus, OpportunityGrade, ConfidenceLevel, PrimaryClassification } from "@/generated/prisma/enums";

export const PAGE_SIZE = 25;

export type FollowUpFilter = "overdue" | "today" | "upcoming" | "none";

export type CompanyListParams = {
  q?: string;
  leadTypeId?: string;
  pipelineStageId?: string;
  assignedToId?: string;
  competitorId?: string;
  triviaStatus?: string;
  country?: string;
  region?: string;
  city?: string;
  opportunityGrade?: string;
  confidenceLevel?: string;
  primaryClassification?: string;
  followUp?: string;
  sortBy?: string;
  sortDir?: string;
  page?: number;
};

const SORTABLE_FIELDS = new Set([
  "name",
  "city",
  "region",
  "country",
  "nextFollowUpAt",
  "eosScore",
  "createdAt",
  "updatedAt",
]);

function allowValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function followUpWhere(followUp: FollowUpFilter | undefined): Prisma.CompanyWhereInput | undefined {
  if (!followUp) return undefined;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  switch (followUp) {
    case "overdue":
      return { nextFollowUpAt: { lt: startOfToday } };
    case "today":
      return { nextFollowUpAt: { gte: startOfToday, lt: startOfTomorrow } };
    case "upcoming":
      return { nextFollowUpAt: { gte: startOfTomorrow } };
    case "none":
      return { nextFollowUpAt: null };
    default:
      return undefined;
  }
}

export async function listCompanies(user: AuthenticatedUser, params: CompanyListParams) {
  const scope = companyScope(user);
  if (!scope) {
    return { companies: [], total: 0, page: 1, pageCount: 1 };
  }

  const triviaStatus = allowValue(params.triviaStatus, Object.values(TriviaStatus));
  const opportunityGrade = allowValue(params.opportunityGrade, Object.values(OpportunityGrade));
  const confidenceLevel = allowValue(params.confidenceLevel, Object.values(ConfidenceLevel));
  const primaryClassification = allowValue(params.primaryClassification, Object.values(PrimaryClassification));
  const followUp = allowValue(params.followUp, ["overdue", "today", "upcoming", "none"] as const);

  const filters: Prisma.CompanyWhereInput[] = [scope, { status: "ACTIVE" }];

  if (params.q) {
    filters.push({
      OR: [
        { name: { contains: params.q, mode: "insensitive" } },
        { city: { contains: params.q, mode: "insensitive" } },
        { email: { contains: params.q, mode: "insensitive" } },
        { phone: { contains: params.q, mode: "insensitive" } },
      ],
    });
  }
  if (params.leadTypeId) filters.push({ leadTypeId: params.leadTypeId });
  if (params.pipelineStageId) filters.push({ pipelineStageId: params.pipelineStageId });
  if (params.assignedToId) filters.push({ assignedToId: params.assignedToId });
  if (params.competitorId) filters.push({ competitorId: params.competitorId });
  if (triviaStatus) filters.push({ triviaStatus });
  if (params.country) filters.push({ country: { equals: params.country, mode: "insensitive" } });
  if (params.region) filters.push({ region: { equals: params.region, mode: "insensitive" } });
  if (params.city) filters.push({ city: { equals: params.city, mode: "insensitive" } });
  if (opportunityGrade) filters.push({ opportunityGrade });
  if (confidenceLevel) filters.push({ confidenceLevel });
  if (primaryClassification) filters.push({ primaryClassification });
  const followUpClause = followUpWhere(followUp);
  if (followUpClause) filters.push(followUpClause);

  const where: Prisma.CompanyWhereInput = { AND: filters };

  const sortBy = params.sortBy && SORTABLE_FIELDS.has(params.sortBy) ? params.sortBy : "name";
  const sortDir = params.sortDir === "desc" ? "desc" : "asc";
  const page = Math.max(1, params.page ?? 1);

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      include: { leadType: true, pipelineStage: true, assignedTo: true, competitor: true },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.company.count({ where }),
  ]);

  return { companies, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getScopedCompany(user: AuthenticatedUser, id: string) {
  const scope = companyScope(user);
  if (!scope) return null;

  return prisma.company.findFirst({
    where: { id, ...scope },
    include: {
      leadType: true,
      pipelineStage: true,
      assignedTo: true,
      competitor: true,
      createdBy: true,
      updatedBy: true,
      archivedBy: true,
      contacts: { orderBy: { lastName: "asc" } },
    },
  });
}

export async function listCompanyTasks(user: AuthenticatedUser, companyId: string) {
  const scope = companyScope(user);
  if (!scope) return [];

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) return [];

  return prisma.task.findMany({
    where: { companyId },
    include: { assignedTo: true },
    orderBy: { dueAt: "asc" },
  });
}

export async function listCompanyEvidence(user: AuthenticatedUser, companyId: string) {
  const scope = companyScope(user);
  if (!scope) return [];

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) return [];

  return prisma.evidenceRecord.findMany({
    where: { companyId },
    include: { createdBy: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function listCompanyScoreHistory(user: AuthenticatedUser, companyId: string) {
  const scope = companyScope(user);
  if (!scope) return [];

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) return [];

  return prisma.historicalScoreRecord.findMany({
    where: { companyId },
    include: { scoredBy: true },
    orderBy: { scoredAt: "desc" },
  });
}

export async function listCompanyActivities(user: AuthenticatedUser, companyId: string) {
  const scope = companyScope(user);
  if (!scope) return [];

  const company = await prisma.company.findFirst({ where: { id: companyId, ...scope } });
  if (!company) return [];

  return prisma.activity.findMany({
    where: { companyId },
    include: { user: true },
    orderBy: { occurredAt: "desc" },
  });
}
