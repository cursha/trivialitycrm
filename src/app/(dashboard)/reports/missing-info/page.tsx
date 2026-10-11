import Link from "next/link";
import clsx from "clsx";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { reportScope } from "@/lib/reports/scope";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { userCode } from "@/lib/ui/user-code";
import { PAGE_SIZE } from "@/app/(dashboard)/companies/queries";
import { listMissingInfo } from "@/lib/data-quality/missing-info";
import { parseMissingFields, type MissingField } from "@/lib/data-quality/missing-info-fields";
import { MissingInfoFilters } from "./missing-info-filters";

export const metadata = { title: "Missing Info — Triviality CRM" };

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MissingInfoReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  // The Reports layout explains a missing report permission; render nothing here.
  const scope = reportScope(user);
  if (!scope) return null;

  const params = await searchParams;
  const fields = parseMissingFields(toSingle(params.missing));
  const page = Number(toSingle(params.page)) || 1;

  const [result, leadTypes, pipelineStages, salespeople] = await Promise.all([
    listMissingInfo(user, scope, {
      q: toSingle(params.q),
      leadTypeId: toSingle(params.leadTypeId),
      pipelineStageId: toSingle(params.pipelineStageId),
      assignedToId: toSingle(params.assignedToId),
      country: toSingle(params.country),
      region: toSingle(params.region),
      city: toSingle(params.city),
      sortBy: toSingle(params.sortBy),
      sortDir: toSingle(params.sortDir),
      fields,
      page,
    }),
    prisma.leadType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.pipelineStage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.user.findMany({ where: { disabled: false }, orderBy: { name: "asc" } }),
  ]);

  if (!result) return <p className="text-text-muted">You do not have permission to view companies.</p>;

  function pageHref(targetPage: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = toSingle(value);
      if (single && key !== "page") query.set(key, single);
    }
    query.set("page", String(targetPage));
    return `/reports/missing-info?${query.toString()}`;
  }

  /** A field's value; when it's empty, a red "Missing" cell if that field is
   * ticked, or a quiet dash if it isn't being looked for. */
  function Cell({ field, value, className }: { field: MissingField; value: string | number | null; className?: string }) {
    const isMissing = value === null || value === "";
    const highlighted = isMissing && fields.includes(field);
    return (
      <td className={clsx("px-4 py-3", highlighted && "bg-danger/10", className)}>
        {highlighted ? <Badge tone="danger">Missing</Badge> : isMissing ? <span className="text-text-muted">—</span> : <span className="break-all">{value}</span>}
      </td>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Every active location missing the ticked information, live from the company records. Missing values are highlighted — click a company to fill them in.
      </p>

      <MissingInfoFilters leadTypes={leadTypes} pipelineStages={pipelineStages} salespeople={salespeople} fields={fields} counts={result.counts} />

      <p className="text-sm font-semibold text-text">
        {result.total.toLocaleString()} location{result.total === 1 ? "" : "s"} missing information
      </p>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-black/5 text-xs uppercase text-text-muted">
              <tr>
                <th className="min-w-56 px-4 py-3">Company</th>
                <th className="px-4 py-3" title="Salesperson">
                  Rep
                </th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Website</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3" title="Entertainment Opportunity Score">
                  EOS
                </th>
              </tr>
            </thead>
            <tbody>
              {result.companies.map((company) => (
                <tr key={company.id} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                      {company.name}
                    </Link>
                    <div className="text-xs text-text-muted">{[company.city, company.region].filter(Boolean).join(", ")}</div>
                  </td>
                  <td className="px-4 py-3">
                    {company.assignedTo ? <span title={company.assignedTo.name}>{userCode(company.assignedTo)}</span> : <span className="text-text-muted">Unassigned</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="secondary">{company.pipelineStage.name}</Badge>
                  </td>
                  <Cell field="phone" value={company.phone} className="whitespace-nowrap" />
                  <Cell field="websiteUrl" value={company.websiteUrl} />
                  <Cell field="email" value={company.email} />
                  <Cell field="eosScore" value={company.eosScore} />
                </tr>
              ))}
              {result.companies.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-text-muted">
                    Nothing missing for these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination page={result.page} pageCount={result.pageCount} pageSize={PAGE_SIZE} hrefFor={pageHref} />
    </div>
  );
}
