import Link from "next/link";
import { CirclePlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { listCompanies, PAGE_SIZE } from "./queries";
import { CompaniesFilters } from "./companies-filters";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { GRADE_TONE, GRADE_LABEL, TRIVIA_STATUS_LABEL } from "@/lib/ui/status-tones";

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

  const [{ companies, total, pageCount }, leadTypes, pipelineStages, competitors, salespeople] = await Promise.all([
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
      sortBy: toSingle(params.sortBy),
      sortDir: toSingle(params.sortDir),
      page,
    }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.competitor.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
  ]);

  const canAdd = hasPermission(user, "add_leads");
  const canExport = hasPermission(user, "export_leads");

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

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-black/5 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Lead Type</th>
                <th className="px-5 py-3">Stage</th>
                <th className="px-5 py-3">Salesperson</th>
                <th className="px-5 py-3">Trivia Status</th>
                <th className="px-5 py-3">EOS Grade</th>
                <th className="px-5 py-3">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="border-t border-border hover:bg-black/5">
                  <td className="px-5 py-4">
                    <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                      {company.name}
                    </Link>
                    <div className="text-xs text-text-muted">
                      {company.city}, {company.region}
                    </div>
                  </td>
                  <td className="px-5 py-4">{company.leadType.name}</td>
                  <td className="px-5 py-4">
                    <Badge tone="secondary">{company.pipelineStage.name}</Badge>
                  </td>
                  <td className="px-5 py-4">{company.assignedTo.name}</td>
                  <td className="px-5 py-4">{TRIVIA_STATUS_LABEL[company.triviaStatus]}</td>
                  <td className="px-5 py-4">
                    {company.opportunityGrade ? (
                      <Badge tone={GRADE_TONE[company.opportunityGrade]}>{GRADE_LABEL[company.opportunityGrade]}</Badge>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {company.nextFollowUpAt ? (
                      new Date(company.nextFollowUpAt).toLocaleDateString()
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-text-muted">
                    No companies match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination page={page} pageCount={pageCount} pageSize={PAGE_SIZE} hrefFor={pageHref} />
    </div>
  );
}
