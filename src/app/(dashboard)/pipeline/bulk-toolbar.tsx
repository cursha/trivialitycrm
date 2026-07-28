"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkChangeStage,
  bulkAssignCompanies,
  bulkSetTerritory,
  bulkCreateFollowUp,
  bulkAddNote,
  bulkArchive,
  bulkRestore,
  type BulkActionOutcome,
} from "@/app/(dashboard)/companies/bulk-actions";
import { bulkAddToRoute, clearRouteAction } from "@/app/(dashboard)/route-plan/actions";
import { downloadRoutePlanCsv } from "@/lib/route-plan/download-client";
import { routeConflictMessage } from "@/lib/route-plan/conflict-message";
import type { BulkAddResult, RouteConflictDetail } from "@/lib/route-plan/service";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label, Select, Input, Textarea } from "@/components/ui/field";
import type { StageOption } from "./company-card";
import { OpportunityAnalysisPanel } from "@/app/(dashboard)/companies/opportunity-analysis-panel";

type Option = { id: string; name: string };
type BulkActionKind = "stage" | "assign" | "territory" | "followup" | "note" | "archive" | "restore" | "analyze" | "route";

export function BulkToolbar({
  selectedIds,
  selectedCompanies,
  stages,
  salespeople,
  territories,
  canBulk,
  canRoutePlan,
  onClear,
}: {
  selectedIds: string[];
  selectedCompanies: Option[];
  stages: StageOption[];
  salespeople: Option[];
  territories: Option[];
  canBulk: boolean;
  canRoutePlan: boolean;
  onClear: () => void;
}) {
  const router = useRouter();
  const [active, setActive] = useState<BulkActionKind | null>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BulkActionOutcome | null>(null);
  const [routeResult, setRouteResult] = useState<BulkAddResult | null>(null);
  const [routeConflict, setRouteConflict] = useState<RouteConflictDetail | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!canBulk || selectedIds.length === 0) return null;

  async function attemptAddToRoute() {
    setExportError(null);
    const outcome = await bulkAddToRoute(selectedIds);
    if (!outcome.ok && "conflict" in outcome) {
      setRouteConflict(outcome.conflict);
      setRouteResult(null);
    } else {
      setRouteConflict(null);
      setRouteResult(outcome);
      if (outcome.ok) router.refresh();
    }
  }

  function handleExportCurrentRouteFirst() {
    startTransition(async () => {
      const download = await downloadRoutePlanCsv();
      if (!download.ok) {
        setExportError(download.error);
        return;
      }
      // Only after the server confirmed success does clearing the old
      // route and adding the pending selection happen — never automatic,
      // per spec 9 ("do not clear automatically") and 5.2 ("clear the
      // route and add the pending company only after explicit
      // confirmation" once export succeeds).
      await clearRouteAction();
      await attemptAddToRoute();
    });
  }

  function handleClearAndStartNew() {
    startTransition(async () => {
      await clearRouteAction();
      await attemptAddToRoute();
    });
  }

  function handleOutcome(outcome: BulkActionOutcome) {
    setResult(outcome);
    if (!("error" in outcome)) {
      router.refresh();
      onClear();
      setActive(null);
    }
  }

  const exportUrl = `/api/export/companies?ids=${selectedIds.join(",")}&format=csv`;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text">{selectedIds.length} selected</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => setActive("stage")}>
            Change stage
          </Button>
          <Button type="button" variant="ghost" onClick={() => setActive("assign")}>
            Assign
          </Button>
          <Button type="button" variant="ghost" onClick={() => setActive("territory")}>
            Set territory
          </Button>
          <Button type="button" variant="ghost" onClick={() => setActive("followup")}>
            Create follow-up
          </Button>
          <Button type="button" variant="ghost" onClick={() => setActive("note")}>
            Add note
          </Button>
          <Button type="button" variant="ghost" onClick={() => setActive("analyze")}>
            Analyze for opportunities
          </Button>
          {canRoutePlan && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setActive("route");
                setRouteResult(null);
                setRouteConflict(null);
                setExportError(null);
                startTransition(attemptAddToRoute);
              }}
            >
              Add Selected to Route
            </Button>
          )}
          <a
            href={exportUrl}
            className="inline-flex items-center justify-center rounded-lg border border-border-strong px-4 py-2.5 text-sm font-bold text-text hover:bg-black/5"
          >
            Export selected
          </a>
          <Button type="button" variant="ghost" onClick={() => setActive("archive")}>
            Archive
          </Button>
          <Button type="button" variant="ghost" onClick={() => setActive("restore")}>
            Restore
          </Button>
        </div>
      </div>

      {result && "error" in result && <Alert tone="danger">{result.error}</Alert>}
      {result && "succeeded" in result && (
        <Alert tone={result.failed.length > 0 ? "warning" : "success"}>
          {result.succeeded.length} succeeded{result.failed.length > 0 ? `, ${result.failed.length} failed` : ""}.
        </Alert>
      )}

      {active === "stage" && (
        <form
          action={(formData) => {
            const newStageId = String(formData.get("stageId"));
            startTransition(async () => handleOutcome(await bulkChangeStage(selectedIds, newStageId)));
          }}
          className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
        >
          <div>
            <Label>New pipeline stage</Label>
            <Select name="stageId" required className="mt-1 w-auto">
              {stages
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </div>
          <p className="text-xs text-text-muted">Will move {selectedIds.length} compan{selectedIds.length === 1 ? "y" : "ies"}.</p>
          <Button type="submit" disabled={isPending} variant="primary">
            Confirm
          </Button>
        </form>
      )}

      {active === "assign" && (
        <form
          action={(formData) => {
            const value = String(formData.get("assignedToId"));
            startTransition(async () => handleOutcome(await bulkAssignCompanies(selectedIds, value || null)));
          }}
          className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
        >
          <div>
            <Label>Assign to</Label>
            <Select name="assignedToId" className="mt-1 w-auto" defaultValue="">
              <option value="">Unassigned</option>
              {salespeople.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-text-muted">Will reassign {selectedIds.length} compan{selectedIds.length === 1 ? "y" : "ies"}.</p>
          <Button type="submit" disabled={isPending} variant="primary">
            Confirm
          </Button>
        </form>
      )}

      {active === "territory" && (
        <form
          action={(formData) => {
            const territoryId = String(formData.get("territoryId"));
            startTransition(async () => handleOutcome(await bulkSetTerritory(selectedIds, territoryId)));
          }}
          className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
        >
          <div>
            <Label>Territory</Label>
            <Select name="territoryId" required className="mt-1 w-auto">
              {territories.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-text-muted">Assigns the selected companies to that territory&apos;s owning salesperson.</p>
          <Button type="submit" disabled={isPending} variant="primary">
            Confirm
          </Button>
        </form>
      )}

      {active === "followup" && (
        <form
          action={(formData) => {
            startTransition(async () =>
              handleOutcome(
                await bulkCreateFollowUp(selectedIds, {
                  title: String(formData.get("title")),
                  notes: String(formData.get("notes") || "") || undefined,
                  dueAt: String(formData.get("dueAt")),
                  assignedToId: String(formData.get("assignedToId")),
                }),
              ),
            );
          }}
          className="space-y-2 border-t border-border pt-3"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Input name="title" placeholder="Title" required />
            <Input name="dueAt" type="date" required />
            <Select name="assignedToId" required defaultValue="">
              <option value="" disabled>
                Assign follow-up to
              </option>
              {salespeople.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </Select>
          </div>
          <Textarea name="notes" placeholder="Notes (optional)" rows={2} />
          <p className="text-xs text-text-muted">
            Creates {selectedIds.length} follow-up{selectedIds.length === 1 ? "" : "s"}, one per selected company.
          </p>
          <Button type="submit" disabled={isPending} variant="primary">
            Confirm
          </Button>
        </form>
      )}

      {active === "note" && (
        <form
          action={(formData) => {
            const note = String(formData.get("note"));
            startTransition(async () => handleOutcome(await bulkAddNote(selectedIds, note)));
          }}
          className="space-y-2 border-t border-border pt-3"
        >
          <Textarea name="note" placeholder="Note text" rows={2} required />
          <p className="text-xs text-text-muted">
            Adds this note to {selectedIds.length} compan{selectedIds.length === 1 ? "y" : "ies"}.
          </p>
          <Button type="submit" disabled={isPending} variant="primary">
            Confirm
          </Button>
        </form>
      )}

      {active === "archive" && (
        <div className="space-y-2 border-t border-border pt-3">
          <Alert tone="warning">
            Archive {selectedIds.length} compan{selectedIds.length === 1 ? "y" : "ies"}? Contacts, activities, and history are preserved and can be restored later.
          </Alert>
          <Button type="button" disabled={isPending} variant="destructive" onClick={() => startTransition(async () => handleOutcome(await bulkArchive(selectedIds)))}>
            Confirm archive
          </Button>
        </div>
      )}

      {active === "restore" && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-text-muted">Restore {selectedIds.length} archived compan{selectedIds.length === 1 ? "y" : "ies"} to active.</p>
          <Button type="button" disabled={isPending} variant="primary" onClick={() => startTransition(async () => handleOutcome(await bulkRestore(selectedIds)))}>
            Confirm restore
          </Button>
        </div>
      )}

      {active === "analyze" && <OpportunityAnalysisPanel companies={selectedCompanies} onClose={() => setActive(null)} />}

      {active === "route" && (
        <div className="space-y-2 border-t border-border pt-3">
          {exportError && <Alert tone="danger">{exportError}</Alert>}

          {routeConflict ? (
            <div className="space-y-2">
              <Alert tone="warning">{routeConflictMessage(routeConflict)}</Alert>
              {routeConflict.type === "ineligible" ? (
                // Eligibility is checked first and is never a route-level
                // conflict to resolve (spec 5.4) — no export/clear choice,
                // just an explanation and a way out.
                <Button type="button" variant="ghost" onClick={() => setActive(null)}>
                  Close
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={isPending} variant="primary" onClick={handleExportCurrentRouteFirst}>
                    Export current route first
                  </Button>
                  <Button type="button" disabled={isPending} variant="destructive" onClick={handleClearAndStartNew}>
                    Clear current route and start new
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setActive(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ) : routeResult ? (
            "ok" in routeResult && routeResult.ok ? (
              <Alert tone="success">
                Added {routeResult.addedCount} compan{routeResult.addedCount === 1 ? "y" : "ies"} to your Route Plan
                {routeResult.alreadyInRouteCount > 0 ? ` (${routeResult.alreadyInRouteCount} already there)` : ""}.
              </Alert>
            ) : (
              "perCompanyErrors" in routeResult && (
                <Alert tone="warning">{Object.values(routeResult.perCompanyErrors).length} compan{Object.values(routeResult.perCompanyErrors).length === 1 ? "y" : "ies"} couldn&apos;t be added — you may not have access to {Object.values(routeResult.perCompanyErrors).length === 1 ? "it" : "them"}.</Alert>
              )
            )
          ) : (
            <p className="text-sm text-text-muted">Adding to your Route Plan…</p>
          )}
        </div>
      )}
    </Card>
  );
}
