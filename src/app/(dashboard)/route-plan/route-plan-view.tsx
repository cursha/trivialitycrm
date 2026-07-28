"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert, X } from "lucide-react";
import { removeFromRoute, clearRouteAction } from "./actions";
import { downloadRoutePlanCsv } from "@/lib/route-plan/download-client";
import type { RouteDetail } from "@/lib/route-plan/service";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type ExportStep = "idle" | "confirming" | "post-download";

export function RoutePlanView({ detail, canManage, canExport }: { detail: RouteDetail; canManage: boolean; canExport: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [exportStep, setExportStep] = useState<ExportStep>("idle");
  const [acknowledgedIncomplete, setAcknowledgedIncomplete] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const incompleteRows = detail.companies.filter((c) => c.missingAddressFields.length > 0);
  const invalidRows = detail.companies.filter((c) => !c.stillValid);

  function handleRemove(companyId: string) {
    startTransition(async () => {
      await removeFromRoute(companyId);
      router.refresh();
    });
  }

  function handleClear() {
    if (!window.confirm(`Clear all ${detail.route.count} compan${detail.route.count === 1 ? "y" : "ies"} from your Route Plan? This cannot be undone.`)) return;
    startTransition(async () => {
      await clearRouteAction();
      setExportStep("idle");
      router.refresh();
    });
  }

  function openExportConfirmation() {
    setExportError(null);
    setAcknowledgedIncomplete(false);
    setExportStep("confirming");
  }

  function handleDownload() {
    startTransition(async () => {
      const result = await downloadRoutePlanCsv();
      if (!result.ok) {
        setExportError(result.error);
        setExportStep("idle");
        return;
      }
      // "Successful" is defined as the server having generated and returned
      // the CSV response — browsers don't reliably report whether the user
      // actually saved the file, so that's deliberately not what this
      // gates on (spec 9).
      setExportStep("post-download");
    });
  }

  if (detail.companies.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-muted">Your Route Plan is empty.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {invalidRows.length > 0 && (
        <Alert tone="danger">
          {invalidRows.length} compan{invalidRows.length === 1 ? "y" : "ies"} no longer match{invalidRows.length === 1 ? "es" : ""} this route&apos;s lead
          type or country (its own lead type or country changed after being added) — remove {invalidRows.length === 1 ? "it" : "them"} before exporting.
        </Alert>
      )}
      {incompleteRows.length > 0 && (
        <Alert tone="warning">
          <span className="flex items-center gap-1.5">
            <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
            {incompleteRows.length} compan{incompleteRows.length === 1 ? "y has an" : "ies have"} incomplete address
            {incompleteRows.length === 1 ? "" : "es"} — still exportable, but you&apos;ll need to acknowledge it first.
          </span>
        </Alert>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-xs uppercase text-text-muted">
            <tr>
              <th className="px-5 py-3">Company Name</th>
              <th className="px-5 py-3">Address</th>
              {canManage && <th className="px-5 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {detail.companies.map((company) => (
              <tr key={company.id} className="border-t border-border align-top">
                <td className="px-5 py-4">
                  <Link href={`/companies/${company.id}`} className="font-bold text-secondary hover:underline">
                    {company.name}
                  </Link>
                  {!company.stillValid && <Badge tone="danger" className="ml-2">Invalid</Badge>}
                </td>
                <td className="px-5 py-4">
                  {company.formattedAddress || <span className="text-text-muted">No address on file</span>}
                  {company.missingAddressFields.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700">
                      <TriangleAlert size={12} className="shrink-0" aria-hidden="true" />
                      Missing {company.missingAddressFields.join(" and ")}
                    </p>
                  )}
                </td>
                {canManage && (
                  <td className="px-5 py-4 text-right">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRemove(company.id)}
                      className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label={`Remove ${company.name} from Route Plan`}
                    >
                      <X size={16} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex flex-wrap gap-2">
        {canManage && (
          <Button type="button" variant="destructive" disabled={isPending} onClick={handleClear}>
            Clear Route Plan
          </Button>
        )}
        {canExport && (
          <Button type="button" variant="primary" disabled={isPending || invalidRows.length > 0} onClick={openExportConfirmation}>
            Export CSV
          </Button>
        )}
      </div>

      {exportError && <Alert tone="danger">{exportError}</Alert>}

      {exportStep === "confirming" && (
        <Card className="space-y-3 border-2 border-secondary">
          <h2 className="font-bold text-accent">Confirm export</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-text-muted">Lead type</dt>
            <dd className="font-semibold text-text">{detail.route.leadTypeName}</dd>
            <dt className="text-text-muted">Country</dt>
            <dd className="font-semibold text-text">{detail.route.country}</dd>
            <dt className="text-text-muted">Companies</dt>
            <dd className="font-semibold text-text">{detail.route.count}</dd>
            <dt className="text-text-muted">Incomplete addresses</dt>
            <dd className="font-semibold text-text">{incompleteRows.length}</dd>
            <dt className="text-text-muted">Filename</dt>
            <dd className="font-semibold text-text">{detail.exportFilename ?? "—"}</dd>
          </dl>
          <p className="text-xs text-text-muted">The file will contain two columns: Name and Address.</p>

          {!detail.exportFilename && (
            <Alert tone="danger">This lead type has no Route Plan filename configured — ask an administrator to set one in Settings &gt; Lead Types.</Alert>
          )}

          {incompleteRows.length > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={acknowledgedIncomplete} onChange={(e) => setAcknowledgedIncomplete(e.target.checked)} className="mt-0.5" />
              <span>
                I understand {incompleteRows.length} compan{incompleteRows.length === 1 ? "y has an" : "ies have"} incomplete address
                {incompleteRows.length === 1 ? "" : "es"} and want to export anyway.
              </span>
            </label>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={isPending || !detail.exportFilename || (incompleteRows.length > 0 && !acknowledgedIncomplete)}
              onClick={handleDownload}
            >
              Download CSV
            </Button>
            <Button type="button" variant="ghost" onClick={() => setExportStep("idle")}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {exportStep === "post-download" && (
        <Card className="space-y-3 border-2 border-secondary">
          <p className="text-sm font-semibold text-text">Clear these companies from your Route Plan?</p>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" disabled={isPending} onClick={handleClear}>
              Clear List
            </Button>
            <Button type="button" variant="ghost" onClick={() => setExportStep("idle")}>
              Keep List
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
