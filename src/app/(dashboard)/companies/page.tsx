import Link from "next/link";
import { CirclePlus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { listCompanies, PAGE_SIZE } from "./queries";
import { CompaniesFilters } from "./companies-filters";

export const metadata = { title: "Companies — Triviality CRM" };

const GRADE_LABELS: Record<string, string> = { A_PLUS: "A+", A: "A", B: "B", C: "C", D: "D" };
const TRIVIA_LABELS: Record<string, string> = {
  CURRENT_TRIVIA: "Current Trivia",
  NO_CURRENT_TRIVIA: "No Current Trivia",
  UNCERTAIN: "Uncertain",
};

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
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Companies</h1>
          <p className="mt-1 text-slate-500">{total} matching companies.</p>
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <a
              href={`/api/export/companies?format=csv${exportQuery ? `&${exportQuery}` : ""}`}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600"
            >
              Export CSV
            </a>
          )}
          {canAdd && (
            <Link
              href="/companies/new"
              className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white shadow-lg shadow-blue-200"
            >
              <CirclePlus size={19} />
              Add company
            </Link>
          )}
        </div>
      </div>

      <CompaniesFilters leadTypes={leadTypes} pipelineStages={pipelineStages} salespeople={salespeople} competitors={competitors} />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
                <tr key={company.id} className="border-t border-slate-100 hover:bg-blue-50/40">
                  <td className="px-5 py-4">
                    <Link href={`/companies/${company.id}`} className="font-bold text-blue-600 hover:underline">
                      {company.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {company.city}, {company.region}
                    </div>
                  </td>
                  <td className="px-5 py-4">{company.leadType.name}</td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                      {company.pipelineStage.name}
                    </span>
                  </td>
                  <td className="px-5 py-4">{company.assignedTo.name}</td>
                  <td className="px-5 py-4">{TRIVIA_LABELS[company.triviaStatus]}</td>
                  <td className="px-5 py-4">
                    {company.opportunityGrade ? (
                      <span className="font-black text-emerald-600">{GRADE_LABELS[company.opportunityGrade]}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {company.nextFollowUpAt ? (
                      new Date(company.nextFollowUpAt).toLocaleDateString()
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-500">
                    No companies match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <Link
            href={pageHref(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={`rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold ${
              page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-slate-50"
            }`}
          >
            Previous
          </Link>
          <p className="text-sm text-slate-500">
            Page {page} of {pageCount} · {PAGE_SIZE} per page
          </p>
          <Link
            href={pageHref(Math.min(pageCount, page + 1))}
            aria-disabled={page >= pageCount}
            className={`rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold ${
              page >= pageCount ? "pointer-events-none opacity-40" : "hover:bg-slate-50"
            }`}
          >
            Next
          </Link>
        </div>
      )}
    </div>
  );
}
