"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GRADE_TONE, GRADE_LABEL, TRIVIA_STATUS_LABEL } from "@/lib/ui/status-tones";
import { BulkToolbar } from "@/app/(dashboard)/pipeline/bulk-toolbar";
import type { StageOption } from "@/app/(dashboard)/pipeline/company-card";
import type { RouteListItem } from "@/lib/route-plan/service";

type Option = { id: string; name: string };

export type CompanyRow = {
  id: string;
  name: string;
  address1: string | null;
  city: string;
  region: string;
  postalCode: string | null;
  leadType: { name: string };
  pipelineStage: { name: string };
  assignedTo: { name: string } | null;
  triviaStatus: string;
  opportunityGrade: string | null;
  nextFollowUpAt: Date | null;
  needsReview: boolean;
};

/** One-line "123 Main St, Toronto, ON M5V 2T6", skipping missing parts. */
function formatAddressLine(company: Pick<CompanyRow, "address1" | "city" | "region" | "postalCode">): string {
  const regionPostal = [company.region, company.postalCode].filter(Boolean).join(" ");
  return [company.address1, company.city, regionPostal].filter(Boolean).join(", ");
}

export function CompaniesTable({
  companies,
  stages,
  salespeople,
  territories,
  routes,
  canBulk,
  canRoutePlan,
  routeNamesByCompany,
  sweetSpotIds,
  showLeadType,
}: {
  companies: CompanyRow[];
  /** False when there's only one lead type — see hasMultipleLeadTypes(). */
  showLeadType: boolean;
  stages: StageOption[];
  salespeople: Option[];
  territories: Option[];
  routes: RouteListItem[];
  canBulk: boolean;
  canRoutePlan: boolean;
  /** Company id → names of the signed-in user's routes it's in (any route,
   * not just the current one) — a persisted-state badge, deliberately
   * separate from `selected` below (a bulk-action page-selection checkbox
   * never means, and must never be confused with, "already in route"). */
  routeNamesByCompany: Record<string, string[]>;
  /** Companies in the sweet spot (most likely to buy). */
  sweetSpotIds: string[];
}) {
  const sweetSpot = new Set(sweetSpotIds);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected = companies.length > 0 && companies.every((c) => selected.has(c.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(companies.map((c) => c.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {canBulk && (
        <BulkToolbar
          selectedIds={Array.from(selected)}
          selectedCompanies={companies.filter((c) => selected.has(c.id)).map((c) => ({ id: c.id, name: c.name }))}
          stages={stages}
          salespeople={salespeople}
          territories={territories}
          routes={routes}
          canBulk={canBulk}
          canRoutePlan={canRoutePlan}
          onClear={() => setSelected(new Set())}
        />
      )}

      <Card className="overflow-hidden p-0">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-black/5 text-xs uppercase text-text-muted">
              <tr>
                {canBulk && (
                  <th className="px-5 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                  </th>
                )}
                <th className="px-5 py-3">Company</th>
                {showLeadType && <th className="px-5 py-3">Lead Type</th>}
                <th className="px-5 py-3">Stage</th>
                <th className="px-5 py-3">Salesperson</th>
                <th className="px-5 py-3">Trivia Status</th>
                <th className="px-5 py-3" title="Entertainment Opportunity Score grade">EOS Grade</th>
                <th className="px-5 py-3">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="border-t border-border hover:bg-black/5">
                  {canBulk && (
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(company.id)}
                        onChange={() => toggleOne(company.id)}
                        aria-label={`Select ${company.name}`}
                      />
                    </td>
                  )}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                        {company.name}
                      </Link>
                      <RouteBadge names={routeNamesByCompany[company.id]} />
                    </div>
                    <div className="max-w-xs truncate text-xs text-text-muted" title={formatAddressLine(company)}>
                      {formatAddressLine(company)}
                    </div>
                  </td>
                  {showLeadType && <td className="px-5 py-4">{company.leadType.name}</td>}
                  <td className="px-5 py-4">
                    <Badge tone="secondary">{company.pipelineStage.name}</Badge>
                  </td>
                  <td className="px-5 py-4">
                    {company.assignedTo?.name ?? <span className="text-text-muted">Unassigned</span>}
                  </td>
                  <td className="px-5 py-4">{TRIVIA_STATUS_LABEL[company.triviaStatus]}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1">
                      {company.opportunityGrade ? (
                        <Badge tone={GRADE_TONE[company.opportunityGrade]}>{GRADE_LABEL[company.opportunityGrade]}</Badge>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                      {sweetSpot.has(company.id) && (
                        <Badge tone="success" title="Most likely to buy: independent, no hosted trivia, EOS 60-89">
                          Sweet spot
                        </Badge>
                      )}
                      {company.needsReview && <Badge tone="warning">Needs review</Badge>}
                    </div>
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
                  <td colSpan={6 + (canBulk ? 1 : 0) + (showLeadType ? 1 : 0)} className="px-5 py-10 text-center text-text-muted">
                    No companies match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ul className="divide-y divide-border md:hidden">
          {companies.map((company) => (
            <li key={company.id} className="p-4">
              <div className="flex items-start gap-3">
                {canBulk && (
                  <input
                    type="checkbox"
                    checked={selected.has(company.id)}
                    onChange={() => toggleOne(company.id)}
                    aria-label={`Select ${company.name}`}
                    className="mt-1 h-5 w-5 shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                        {company.name}
                      </Link>
                      <RouteBadge names={routeNamesByCompany[company.id]} />
                    </div>
                    <Badge tone="secondary" className="shrink-0">
                      {company.pipelineStage.name}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-muted">{formatAddressLine(company)}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    {showLeadType && (
                      <div>
                        <dt className="text-text-muted">Lead type</dt>
                        <dd className="font-medium text-text">{company.leadType.name}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-text-muted">Salesperson</dt>
                      <dd className="font-medium text-text">{company.assignedTo?.name ?? "Unassigned"}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">Trivia status</dt>
                      <dd className="font-medium text-text">{TRIVIA_STATUS_LABEL[company.triviaStatus]}</dd>
                    </div>
                    <div>
                      <dt className="text-text-muted">EOS grade</dt>
                      <dd className="flex flex-wrap items-center gap-1 font-medium text-text">
                        {company.opportunityGrade ? GRADE_LABEL[company.opportunityGrade] : "—"}
                        {sweetSpot.has(company.id) && <Badge tone="success">Sweet spot</Badge>}
                        {company.needsReview && <Badge tone="warning">Needs review</Badge>}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-text-muted">Next follow-up</dt>
                      <dd className="font-medium text-text">
                        {company.nextFollowUpAt ? new Date(company.nextFollowUpAt).toLocaleDateString() : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </li>
          ))}
          {companies.length === 0 && (
            <li className="px-5 py-10 text-center text-text-muted">No companies match these filters.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}

/** "In route: Oakville", or "In 2 routes" with the names on hover. */
function RouteBadge({ names }: { names: string[] | undefined }) {
  if (!names?.length) return null;
  const label = names.length === 1 ? `In route: ${names[0]}` : `In ${names.length} routes`;
  return (
    <Badge tone="focus" className="max-w-40 truncate" title={names.join(", ")}>
      {label}
    </Badge>
  );
}
