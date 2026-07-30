import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { companyScope } from "@/lib/companies/scope";
import { dayBounds } from "@/lib/dates";
import type { Prisma } from "@/generated/prisma/client";
import { TriviaStatus, OpportunityGrade, ConfidenceLevel, PrimaryClassification } from "@/generated/prisma/enums";

export const PAGE_SIZE = 25;

export type FollowUpFilter = "overdue" | "today" | "upcoming" | "none";

// "Contact" activity types for the never-contacted/last-contacted filters
// below — deliberately excludes NOTE (not necessarily a contact event) and
// the system-generated types (PIPELINE_CHANGE/ASSIGNMENT_CHANGE/
// LEAD_TRANSFERRED/COMPANY_MERGED), which never represent reaching out to
// the company itself.
const CONTACT_ACTIVITY_TYPES = ["PHONE", "EMAIL", "MEETING", "MATERIAL_SENT", "DEMO", "TRIAL"] as const;

export type CompanyListParams = {
  q?: string;
  leadTypeId?: string;
  pipelineStageId?: string;
  assignedToId?: string;
  /** True restricts to companies with no assignee at all — distinct from
   * assignedToId being unset (which means "no filter on assignee"). */
  unassignedOnly?: boolean;
  competitorId?: string;
  triviaStatus?: string;
  country?: string;
  region?: string;
  city?: string;
  /** Matches any of these cities (case-insensitive) — the multi-city
   * equivalent of `city` above. Was declared on SavedViewFiltersSchema
   * since Module Four but never consumed by this function; wired in here. */
  cities?: string[];
  opportunityGrade?: string;
  confidenceLevel?: string;
  primaryClassification?: string;
  followUp?: string;
  /** Filters to companies whose current pipeline stage has this outcome
   * flag — never a hardcoded stage name, see PipelineStage.outcomeType. */
  outcome?: "WON" | "LOST";
  /** Defaults to ACTIVE, matching every existing caller's expectation. */
  status?: "ACTIVE" | "ARCHIVED";
  /** Inclusive EOS-1.0 total score range. Was declared as scoreMin/scoreMax
   * on SavedViewFiltersSchema since Module Four but never consumed by this
   * function; wired in here (the Reports feature's own, separate
   * reportFiltersToCompanyWhere already implemented an equivalent range —
   * this is the same idea, applied to the shared company-list builder). */
  scoreMin?: number;
  scoreMax?: number;
  /** ISO "YYYY-MM-DD" creation-date range. Same dormant-since-Module-Four
   * story as scoreMin/scoreMax above. */
  createdFrom?: string;
  createdTo?: string;
  /** True restricts to companies with zero PHONE/EMAIL/MEETING/
   * MATERIAL_SENT/DEMO/TRIAL activities ever recorded. */
  neverContactedOnly?: boolean;
  /** Restricts to companies that HAVE been contacted (see above) but whose
   * most recent contact activity was before this ISO "YYYY-MM-DD" date —
   * deliberately excludes never-contacted companies, which are their own
   * separate filter above rather than folded into "contacted long ago." */
  lastContactedBefore?: string;
  /** true = must have a phone/email on file; false = must be missing one.
   * Undefined = no filter on this field. */
  hasPhone?: boolean;
  hasEmail?: boolean;
  isExistingCustomer?: boolean;
  doNotContactOnly?: boolean;
  /** true = Company.lastScoredAt is null (never run through EOS analysis). */
  neverAnalyzedOnly?: boolean;
  /** ISO "YYYY-MM-DD" — restricts to companies last analyzed before this
   * date. Companies never analyzed are excluded (their own filter above). */
  lastAnalyzedBefore?: string;
  /** true = has at least one open (OPEN/REOPENED/DEFERRED) DataQualityIssue. */
  hasDataQualityWarnings?: boolean;
  sortBy?: string;
  sortDir?: string;
  page?: number;
};

// Exported as a literal array (not just the Set built from it) so
// saved-view-filters.ts can validate a stored sortBy against the same
// whitelist without duplicating it.
export const SORTABLE_FIELDS_LIST = [
  "name",
  "city",
  "region",
  "country",
  "nextFollowUpAt",
  "eosScore",
  "createdAt",
  "updatedAt",
] as const;
const SORTABLE_FIELDS = new Set<string>(SORTABLE_FIELDS_LIST);

function allowValue<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function followUpWhere(followUp: FollowUpFilter | undefined): Prisma.CompanyWhereInput | undefined {
  if (!followUp) return undefined;

  const { startOfToday, startOfTomorrow } = dayBounds();

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

/**
 * Builds the WHERE clause shared by every company list/board view — the
 * Pipeline page's board and named views call this directly (with their own
 * `include`/pagination) instead of duplicating filter logic. Returns null
 * if the user has no lead-view permission at all (callers must deny).
 */
export function buildCompanyWhere(user: AuthenticatedUser, params: CompanyListParams): Prisma.CompanyWhereInput | null {
  const scope = companyScope(user);
  if (!scope) return null;

  const triviaStatus = allowValue(params.triviaStatus, Object.values(TriviaStatus));
  const opportunityGrade = allowValue(params.opportunityGrade, Object.values(OpportunityGrade));
  const confidenceLevel = allowValue(params.confidenceLevel, Object.values(ConfidenceLevel));
  const primaryClassification = allowValue(params.primaryClassification, Object.values(PrimaryClassification));
  const followUp = allowValue(params.followUp, ["overdue", "today", "upcoming", "none"] as const);

  const filters: Prisma.CompanyWhereInput[] = [scope, { status: params.status ?? "ACTIVE" }];

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
  if (params.unassignedOnly) {
    filters.push({ assignedToId: null });
  } else if (params.assignedToId) {
    filters.push({ assignedToId: params.assignedToId });
  }
  if (params.competitorId) filters.push({ competitorId: params.competitorId });
  if (triviaStatus) filters.push({ triviaStatus });
  if (params.country) filters.push({ country: { equals: params.country, mode: "insensitive" } });
  if (params.region) filters.push({ region: { equals: params.region, mode: "insensitive" } });
  if (params.city) filters.push({ city: { equals: params.city, mode: "insensitive" } });
  if (params.cities && params.cities.length > 0) {
    filters.push({ OR: params.cities.map((c) => ({ city: { equals: c, mode: "insensitive" as const } })) });
  }
  if (opportunityGrade) filters.push({ opportunityGrade });
  if (confidenceLevel) filters.push({ confidenceLevel });
  if (primaryClassification) filters.push({ primaryClassification });
  if (params.outcome) filters.push({ pipelineStage: { outcomeType: params.outcome } });
  const followUpClause = followUpWhere(followUp);
  if (followUpClause) filters.push(followUpClause);

  if (params.scoreMin !== undefined) filters.push({ eosScore: { gte: params.scoreMin } });
  if (params.scoreMax !== undefined) filters.push({ eosScore: { lte: params.scoreMax } });
  if (params.createdFrom) filters.push({ createdAt: { gte: new Date(params.createdFrom) } });
  if (params.createdTo) filters.push({ createdAt: { lte: new Date(params.createdTo) } });

  if (params.neverContactedOnly) {
    filters.push({ activities: { none: { type: { in: [...CONTACT_ACTIVITY_TYPES] } } } });
  }
  if (params.lastContactedBefore) {
    const cutoff = new Date(params.lastContactedBefore);
    filters.push({ activities: { some: { type: { in: [...CONTACT_ACTIVITY_TYPES] } } } });
    filters.push({ activities: { none: { type: { in: [...CONTACT_ACTIVITY_TYPES] }, occurredAt: { gte: cutoff } } } });
  }
  if (params.hasPhone !== undefined) filters.push({ phone: params.hasPhone ? { not: null } : null });
  if (params.hasEmail !== undefined) filters.push({ email: params.hasEmail ? { not: null } : null });
  if (params.isExistingCustomer !== undefined) filters.push({ isExistingCustomer: params.isExistingCustomer });
  if (params.doNotContactOnly) filters.push({ doNotContact: true });
  if (params.neverAnalyzedOnly) filters.push({ lastScoredAt: null });
  if (params.lastAnalyzedBefore) {
    filters.push({ lastScoredAt: { not: null, lt: new Date(params.lastAnalyzedBefore) } });
  }
  if (params.hasDataQualityWarnings) {
    filters.push({ dataQualityIssues: { some: { status: { in: ["OPEN", "REOPENED", "DEFERRED"] } } } });
  }

  return { AND: filters };
}

export async function listCompanies(user: AuthenticatedUser, params: CompanyListParams) {
  const where = buildCompanyWhere(user, params);
  if (!where) {
    return { companies: [], total: 0, page: 1, pageCount: 1 };
  }

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
      contacts: { where: { status: "ACTIVE" }, orderBy: { lastName: "asc" } },
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
