import Link from "next/link";
import { CirclePlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { listCompanies, PAGE_SIZE } from "./queries";
import { CompaniesFilters } from "./companies-filters";
import { CompaniesTable } from "./companies-table";
import { getRouteCompanyIds } from "@/lib/route-plan/service";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";

export const metadata = { title: "Companies — Triviality CRM" };

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const page = Number(toSingle(params.page)) || 1;

  const statusParam = toSingle(params.status) === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";

  const canRoutePlan = hasPermission(user, "manage_route_plan");

  const [{ companies, total, pageCount }, leadTypes, pipelineStages, allPipelineStages, competitors, salespeople, territories, routeCompanyIds] =
    await Promise.all([
      listCompanies(user, {
        q: toSingle(params.q),
        leadTypeId: toSingle(params.leadTypeId),
        pipelineStageId: toSingle(params.pipelineStageId),
        assignedToId: toSingle(params.assignedToId),
        competitorId: toSingle(params.competitorId),
        triviaStatus: toSingle(params.triviaStatus),
        country: toSingle(params.country),
        region: toSingle(params.region),
        city: toSingle(params.city),
        opportunityGrade: toSingle(params.opportunityGrade),
        confidenceLevel: toSingle(params.confidenceLevel),
        primaryClassification: toSingle(params.primaryClassification),
        followUp: toSingle(params.followUp),
        status: statusParam,
        sortBy: toSingle(params.sortBy),
        sortDir: toSingle(params.sortDir),
        page,
      }),
      prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      prisma.pipelineStage.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
      prisma.territory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      canRoutePlan ? getRouteCompanyIds(user.id) : Promise.resolve(new Set<string>()),
    ]);

  const canAdd = hasPermission(user, "add_leads");
  const canExport = hasPermission(user, "export_leads");
  const canBulk = hasPermission(user, "bulk_update_leads");

  const exportQuery = new URLSearchParams(
    ["leadTypeId", "pipelineStageId", "competitorId"]
      .map((key) => [key, toSingle(params[key])] as const)
      .filter((entry): entry is [string, string] => !!entry[1]),
  ).toString();

  const queryWithoutPage = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      key === "page" ? [] : (Array.isArray(value) ? value : [value]).filter((v): v is string => !!v).map((v) => [key, v]),
    ),
  ).toString();

  function pageHref(targetPage: number) {
    const query = new URLSearchParams(queryWithoutPage);
    query.set("page", String(targetPage));
    return `/companies?${query.toString()}`;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Companies"
        description={`${total} matching companies.`}
        actions={
          <>
            {canExport && (
              <a
                href={`/api/export/companies?format=csv${exportQuery ? `&${exportQuery}` : ""}`}
                className="rounded-lg border border-border-strong px-4 py-2.5 text-sm font-semibold text-text hover:bg-black/5"
              >
                Export CSV
              </a>
            )}
            {canAdd && (
              <Link
                href="/companies/new"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover"
              >
                <CirclePlus size={17} />
                Add company
              </Link>
            )}
          </>
        }
      />

      <CompaniesFilters leadTypes={leadTypes} pipelineStages={pipelineStages} salespeople={salespeople} competitors={competitors} />

      <CompaniesTable
        companies={companies}
        stages={allPipelineStages.map((s) => ({ id: s.id, name: s.name, active: s.active }))}
        salespeople={salespeople}
        territories={territories.map((t) => ({ id: t.id, name: t.name ?? [t.city, t.region, t.country].filter(Boolean).join(", ") }))}
        canBulk={canBulk}
        canRoutePlan={canRoutePlan}
        routeCompanyIds={Array.from(routeCompanyIds)}
      />

      <Pagination page={page} pageCount={pageCount} pageSize={PAGE_SIZE} hrefFor={pageHref} />
    </div>
  );
}
