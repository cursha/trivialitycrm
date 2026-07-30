"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TRIVIA_STATUS_LABEL } from "@/lib/ui/status-tones";
import { evaluateCompanyEligibility } from "@/lib/sales-lists/eligibility";
import { removeCompanyFromList } from "../actions";
import type { SalesListCompanyRow } from "@/lib/sales-lists/queries";
import type { SalesListPurpose } from "@/generated/prisma/enums";

export function ListDetailTable({
  listId,
  purpose,
  type,
  companies,
  lastContactByCompanyId,
  canManage,
}: {
  listId: string;
  purpose: SalesListPurpose;
  type: "FIXED" | "DYNAMIC";
  companies: SalesListCompanyRow[];
  lastContactByCompanyId: Record<string, Date | null>;
  canManage: boolean;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove(companyId: string) {
    setRemovingId(companyId);
    startTransition(async () => {
      await removeCompanyFromList(listId, companyId);
      setRemovingId(null);
    });
  }

  function eligibilityFor(company: SalesListCompanyRow) {
    return evaluateCompanyEligibility(
      {
        status: company.status,
        doNotContact: company.doNotContact,
        isExistingCustomer: company.isExistingCustomer,
        phone: company.phone,
        primaryContact: company.primaryContact
          ? {
              status: company.primaryContact.status,
              email: company.primaryContact.email,
              phone: company.primaryContact.phone,
              doNotContact: company.primaryContact.doNotContact,
              unsubscribedAt: company.primaryContact.unsubscribedAt,
            }
          : null,
      },
      purpose,
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-xs uppercase text-text-muted">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Primary Contact</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Lead Type</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">EOS</th>
              <th className="px-4 py-3">Confidence</th>
              <th className="px-4 py-3">Competitor</th>
              <th className="px-4 py-3">Trivia Status</th>
              <th className="px-4 py-3">Last Contact</th>
              <th className="px-4 py-3">Next Action</th>
              <th className="px-4 py-3">Eligibility</th>
              {type === "FIXED" && canManage && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {companies.map((company) => {
              const { eligible, reasons } = eligibilityFor(company);
              const lastContact = lastContactByCompanyId[company.id];
              return (
                <tr key={company.id} className="border-t border-border hover:bg-black/5">
                  <td className="px-4 py-3">
                    <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                      {company.name}
                    </Link>
                    <div className="text-xs text-text-muted">
                      {company.city}, {company.region}
                    </div>
                  </td>
                  <td className="px-4 py-3">{company.assignedTo?.name ?? <span className="text-text-muted">Unassigned</span>}</td>
                  <td className="px-4 py-3">
                    {company.primaryContact ? `${company.primaryContact.firstName} ${company.primaryContact.lastName}` : <span className="text-text-muted">None</span>}
                  </td>
                  <td className="px-4 py-3">{company.phone ?? <span className="text-text-muted">—</span>}</td>
                  <td className="px-4 py-3">{company.email ?? <span className="text-text-muted">—</span>}</td>
                  <td className="px-4 py-3">{company.leadType.name}</td>
                  <td className="px-4 py-3">
                    <Badge tone="secondary">{company.pipelineStage.name}</Badge>
                  </td>
                  <td className="px-4 py-3">{company.eosScore ?? "—"}</td>
                  <td className="px-4 py-3">{company.confidenceLevel ?? "—"}</td>
                  <td className="px-4 py-3">{company.competitor?.name ?? "—"}</td>
                  <td className="px-4 py-3">{TRIVIA_STATUS_LABEL[company.triviaStatus]}</td>
                  <td className="px-4 py-3">{lastContact ? new Date(lastContact).toLocaleDateString() : <span className="text-text-muted">Never</span>}</td>
                  <td className="px-4 py-3">{company.nextFollowUpAt ? new Date(company.nextFollowUpAt).toLocaleDateString() : <span className="text-text-muted">None</span>}</td>
                  <td className="px-4 py-3">
                    {eligible ? (
                      <Badge tone="success">Eligible</Badge>
                    ) : (
                      <div className="space-y-0.5">
                        <Badge tone="danger">Ineligible</Badge>
                        <div className="text-xs text-text-muted">{reasons.join("; ")}</div>
                      </div>
                    )}
                  </td>
                  {type === "FIXED" && canManage && (
                    <td className="px-4 py-3">
                      <Button variant="ghost" onClick={() => remove(company.id)} disabled={isPending && removingId === company.id}>
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
            {companies.length === 0 && (
              <tr>
                <td colSpan={15} className="px-4 py-10 text-center text-text-muted">
                  No companies to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border md:hidden">
        {companies.map((company) => {
          const { eligible, reasons } = eligibilityFor(company);
          const lastContact = lastContactByCompanyId[company.id];
          return (
            <li key={company.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                    {company.name}
                  </Link>
                  <p className="text-xs text-text-muted">
                    {company.city}, {company.region}
                  </p>
                </div>
                {eligible ? <Badge tone="success">Eligible</Badge> : <Badge tone="danger">Ineligible</Badge>}
              </div>
              {!eligible && <p className="mt-1 text-xs text-text-muted">{reasons.join("; ")}</p>}
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-text-muted">Owner</dt>
                  <dd className="font-medium text-text">{company.assignedTo?.name ?? "Unassigned"}</dd>
                </div>
                <div>
                  <dt className="text-text-muted">Primary contact</dt>
                  <dd className="font-medium text-text">{company.primaryContact ? `${company.primaryContact.firstName} ${company.primaryContact.lastName}` : "None"}</dd>
                </div>
                <div>
                  <dt className="text-text-muted">Stage</dt>
                  <dd className="font-medium text-text">{company.pipelineStage.name}</dd>
                </div>
                <div>
                  <dt className="text-text-muted">Last contact</dt>
                  <dd className="font-medium text-text">{lastContact ? new Date(lastContact).toLocaleDateString() : "Never"}</dd>
                </div>
              </dl>
              {type === "FIXED" && canManage && (
                <Button variant="ghost" className="mt-2" onClick={() => remove(company.id)} disabled={isPending && removingId === company.id}>
                  Remove from list
                </Button>
              )}
            </li>
          );
        })}
        {companies.length === 0 && <li className="px-4 py-10 text-center text-text-muted">No companies to show.</li>}
      </ul>
    </Card>
  );
}
