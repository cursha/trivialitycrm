"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GRADE_TONE, GRADE_LABEL, TRIVIA_STATUS_LABEL } from "@/lib/ui/status-tones";
import { BulkToolbar } from "@/app/(dashboard)/pipeline/bulk-toolbar";
import type { StageOption } from "@/app/(dashboard)/pipeline/company-card";

type Option = { id: string; name: string };

export type CompanyRow = {
  id: string;
  name: string;
  city: string;
  region: string;
  leadType: { name: string };
  pipelineStage: { name: string };
  assignedTo: { name: string } | null;
  triviaStatus: string;
  opportunityGrade: string | null;
  nextFollowUpAt: Date | null;
};

export function CompaniesTable({
  companies,
  stages,
  salespeople,
  territories,
  canBulk,
}: {
  companies: CompanyRow[];
  stages: StageOption[];
  salespeople: Option[];
  territories: Option[];
  canBulk: boolean;
}) {
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
          stages={stages}
          salespeople={salespeople}
          territories={territories}
          canBulk={canBulk}
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
                  <td className="px-5 py-4">
                    {company.assignedTo?.name ?? <span className="text-text-muted">Unassigned</span>}
                  </td>
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
                  <td colSpan={canBulk ? 8 : 7} className="px-5 py-10 text-center text-text-muted">
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
                    <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                      {company.name}
                    </Link>
                    <Badge tone="secondary" className="shrink-0">
                      {company.pipelineStage.name}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-muted">
                    {company.city}, {company.region}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-text-muted">Lead type</dt>
                      <dd className="font-medium text-text">{company.leadType.name}</dd>
                    </div>
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
                      <dd className="font-medium text-text">
                        {company.opportunityGrade ? GRADE_LABEL[company.opportunityGrade] : "—"}
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
