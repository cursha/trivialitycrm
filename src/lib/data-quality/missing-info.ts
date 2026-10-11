import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import { reportCompanyWhere, type ReportScope } from "@/lib/reports/scope";
import { buildCompanyWhere, companyOrderBy, PAGE_SIZE, type CompanyListParams } from "@/app/(dashboard)/companies/queries";
import type { Prisma } from "@/generated/prisma/client";
import { MISSING_FIELDS, type MissingField } from "./missing-info-fields";

/**
 * The Missing Info report (Reports → Missing Info): every location missing a
 * phone, website, email or EOS score, worked out live from the company
 * records rather than from the last data-quality scan.
 */

/** A text field counts as missing when it's empty or blank, not only null. */
function missingWhere(field: MissingField): Prisma.CompanyWhereInput {
  if (field === "eosScore") return { eosScore: null };
  return { OR: [{ [field]: null }, { [field]: "" }] };
}

export type MissingInfoParams = Pick<CompanyListParams, "q" | "leadTypeId" | "pipelineStageId" | "assignedToId" | "country" | "region" | "city" | "sortBy" | "sortDir"> & {
  /** Show locations missing any of these. */
  fields: MissingField[];
  page?: number;
};

/** Null when the viewer may not see companies at all. Narrowed by both the
 * viewer's company access and their report scope, like every report. */
export async function listMissingInfo(user: AuthenticatedUser, scope: ReportScope, params: MissingInfoParams) {
  const { fields, page: requestedPage, ...filters } = params;
  const companyWhere = buildCompanyWhere(user, filters);
  if (!companyWhere) return null;
  const base: Prisma.CompanyWhereInput = { AND: [companyWhere, reportCompanyWhere(scope)] };

  const where: Prisma.CompanyWhereInput = { AND: [base, { OR: fields.map(missingWhere) }] };
  const page = Math.max(1, requestedPage ?? 1);

  const [companies, total, ...fieldCounts] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: companyOrderBy(params.sortBy, params.sortDir),
      select: {
        id: true,
        name: true,
        city: true,
        region: true,
        phone: true,
        websiteUrl: true,
        email: true,
        eosScore: true,
        pipelineStage: { select: { name: true } },
        assignedTo: { select: { name: true, initials: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.company.count({ where }),
    // How many filtered locations are missing each field, ticked or not, so
    // the count beside every checkbox is always visible.
    ...MISSING_FIELDS.map((field) => prisma.company.count({ where: { AND: [base, missingWhere(field)] } })),
  ]);

  const counts = Object.fromEntries(MISSING_FIELDS.map((field, i) => [field, fieldCounts[i]])) as Record<MissingField, number>;
  return { companies, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), counts };
}
