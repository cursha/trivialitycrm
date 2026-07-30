"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label, Select, FieldError } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { evaluateCompanyEligibility } from "@/lib/sales-lists/eligibility";
import { createSalesList, updateSalesList, selectAllMatchingIds } from "../actions";
import type { SalesListCompanyRow } from "@/lib/sales-lists/queries";
import type { SalesListPurpose } from "@/generated/prisma/enums";

type Option = { id: string; name: string };

export function ListBuilder({
  purpose,
  filters,
  companies,
  total,
  users,
  hasTeam,
  editList,
}: {
  purpose: SalesListPurpose;
  filters: Record<string, unknown>;
  companies: SalesListCompanyRow[];
  total: number;
  users: Option[];
  hasTeam: boolean;
  /** When set, this builder is editing an existing DYNAMIC list's filters
   * in place (via updateSalesList) instead of creating a new list — reuses
   * every other piece of this component (preview, filter form) as-is. */
  editList?: { id: string; name: string; description: string | null; visibility: "PRIVATE" | "SHARED_USERS" | "SHARED_TEAM"; sharedUserIds: string[] };
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [selectAllNotice, setSelectAllNotice] = useState<string | null>(null);

  const [name, setName] = useState(editList?.name ?? "");
  const [description, setDescription] = useState(editList?.description ?? "");
  const [visibility, setVisibility] = useState<"PRIVATE" | "SHARED_USERS" | "SHARED_TEAM">(editList?.visibility ?? "PRIVATE");
  const [sharedUserIds, setSharedUserIds] = useState<string[]>(editList?.sharedUserIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const allOnPageSelected = companies.length > 0 && companies.every((c) => selected.has(c.id));

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) companies.forEach((c) => next.delete(c.id));
      else companies.forEach((c) => next.add(c.id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllMatching() {
    startTransition(async () => {
      const result = await selectAllMatchingIds(filters);
      setSelected(new Set(result.ids));
      setSelectAllNotice(
        result.truncated
          ? `Selected the first ${result.ids.length.toLocaleString()} matching companies (this filter matches more — narrow it to select every one).`
          : `Selected all ${result.ids.length.toLocaleString()} matching companies.`,
      );
    });
  }

  function save(type: "FIXED" | "DYNAMIC") {
    setError(null);
    if (!name.trim()) {
      setError("Enter a name for this list.");
      return;
    }
    if (type === "FIXED" && selected.size === 0) {
      setError("Select at least one company to save as a fixed list.");
      return;
    }
    if (visibility === "SHARED_USERS" && sharedUserIds.length === 0) {
      setError("Choose at least one person to share this list with.");
      return;
    }

    startTransition(async () => {
      const result = editList
        ? await updateSalesList(editList.id, {
            name,
            description,
            visibility,
            filters,
            sharedUserIds: visibility === "SHARED_USERS" ? sharedUserIds : undefined,
          })
        : await createSalesList({
            name,
            description,
            purpose,
            type,
            visibility,
            filters: type === "DYNAMIC" ? filters : undefined,
            companyIds: type === "FIXED" ? Array.from(selected) : undefined,
            sharedUserIds: visibility === "SHARED_USERS" ? sharedUserIds : undefined,
          });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSavedId(result.id);
      router.push(`/sales-lists/${result.id}`);
    });
  }

  if (savedId) {
    return (
      <Alert tone="success">
        List saved. <Link href={`/sales-lists/${savedId}`} className="underline">Open it</Link>.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">
            {total.toLocaleString()} matching compan{total === 1 ? "y" : "ies"}
          </span>
          <Button type="button" variant="ghost" onClick={toggleAllOnPage}>
            {allOnPageSelected ? "Unselect page" : "Select page"}
          </Button>
          <Button type="button" variant="ghost" onClick={selectAllMatching} disabled={isPending}>
            Select all matching
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            Clear selection
          </Button>
        </div>
        <span className="text-sm font-semibold text-secondary">{selected.size.toLocaleString()} selected</span>
      </Card>
      {selectAllNotice && <Alert tone="info">{selectAllNotice}</Alert>}

      <Card className="overflow-hidden p-0">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-black/5 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-5 py-3">
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} aria-label="Select all on page" />
                </th>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Owner</th>
                <th className="px-5 py-3">Primary Contact</th>
                <th className="px-5 py-3">EOS</th>
                <th className="px-5 py-3">Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const { eligible, reasons } = evaluateCompanyEligibility(
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
                return (
                  <tr key={company.id} className="border-t border-border hover:bg-black/5">
                    <td className="px-5 py-4">
                      <input type="checkbox" checked={selected.has(company.id)} onChange={() => toggleOne(company.id)} aria-label={`Select ${company.name}`} />
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                        {company.name}
                      </Link>
                      <div className="text-xs text-text-muted">
                        {company.city}, {company.region}
                      </div>
                    </td>
                    <td className="px-5 py-4">{company.assignedTo?.name ?? <span className="text-text-muted">Unassigned</span>}</td>
                    <td className="px-5 py-4">
                      {company.primaryContact ? `${company.primaryContact.firstName} ${company.primaryContact.lastName}` : <span className="text-text-muted">None</span>}
                    </td>
                    <td className="px-5 py-4">{company.eosScore ?? <span className="text-text-muted">—</span>}</td>
                    <td className="px-5 py-4">
                      {eligible ? (
                        <Badge tone="success">Eligible</Badge>
                      ) : (
                        <div className="space-y-0.5">
                          <Badge tone="danger">Ineligible</Badge>
                          <div className="text-xs text-text-muted">{reasons.join("; ")}</div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-text-muted">
                    No companies match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ul className="divide-y divide-border md:hidden">
          {companies.map((company) => {
            const { eligible, reasons } = evaluateCompanyEligibility(
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
            return (
              <li key={company.id} className="p-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(company.id)}
                    onChange={() => toggleOne(company.id)}
                    aria-label={`Select ${company.name}`}
                  />
                  <div className="flex-1">
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
                        <dd className="font-medium text-text">
                          {company.primaryContact ? `${company.primaryContact.firstName} ${company.primaryContact.lastName}` : "None"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-text-muted">EOS</dt>
                        <dd className="font-medium text-text">{company.eosScore ?? "—"}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </li>
            );
          })}
          {companies.length === 0 && <li className="px-5 py-10 text-center text-text-muted">No companies match these filters.</li>}
        </ul>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-bold">Save this list</p>
        {error && <FieldError>{error}</FieldError>}
        <div>
          <Label htmlFor="list-name">Name</Label>
          <Input id="list-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
        </div>
        <div>
          <Label htmlFor="list-description">Description</Label>
          <Textarea id="list-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div>
          <Label htmlFor="list-visibility">Visibility</Label>
          <Select id="list-visibility" className="w-auto" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
            <option value="PRIVATE">Private (only me)</option>
            <option value="SHARED_USERS">Shared with selected users</option>
            <option value="SHARED_TEAM" disabled={!hasTeam}>
              Shared with my team{!hasTeam ? " (you're not on a team)" : ""}
            </option>
          </Select>
        </div>
        {visibility === "SHARED_USERS" && (
          <div>
            <Label htmlFor="list-shared-users">Share with</Label>
            <select
              id="list-shared-users"
              multiple
              className="w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2 text-sm"
              value={sharedUserIds}
              onChange={(e) => setSharedUserIds(Array.from(e.target.selectedOptions, (o) => o.value))}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          {!editList && (
            <Button type="button" onClick={() => save("FIXED")} disabled={isPending}>
              Save as fixed list ({selected.size} selected)
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={() => save("DYNAMIC")} disabled={isPending}>
            {editList ? `Save changes (${total.toLocaleString()} currently matching)` : `Save as dynamic list (${total.toLocaleString()} currently matching)`}
          </Button>
        </div>
      </Card>
    </div>
  );
}
