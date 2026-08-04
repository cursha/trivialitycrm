"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cancelCompetitionLocatorRun, retryCompetitionLocatorRunWithOverride } from "./actions";
import { isBudgetBlockedReason } from "@/lib/ai/budget";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/lib/ui/status-tones";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type CurrentActivity = { region: string; country: string; message: string | null } | null;

type StatusPayload = {
  status: "RUNNING" | "PARTIAL_FAILURE" | "SUCCEEDED" | "CANCELLED";
  totalRegions: number;
  completedRegions: number;
  found: number;
  verified: number;
  rejected: number;
  needsReview: number;
  possibleDuplicates: number;
  errors: string[];
  currentActivity: CurrentActivity;
};

const STATUS_TONE: Record<StatusPayload["status"], BadgeTone> = {
  RUNNING: "focus",
  PARTIAL_FAILURE: "warning",
  SUCCEEDED: "success",
  CANCELLED: "neutral",
};

const STATUS_LABEL: Record<StatusPayload["status"], string> = {
  RUNNING: "Running",
  PARTIAL_FAILURE: "Completed with errors",
  SUCCEEDED: "Complete",
  CANCELLED: "Cancelled",
};

const TERMINAL = new Set<StatusPayload["status"]>(["SUCCEEDED", "PARTIAL_FAILURE", "CANCELLED"]);

export function RunStatus({ runId, initial, canOverrideBudget }: { runId: string; initial: StatusPayload; canOverrideBudget: boolean }) {
  const [status, setStatus] = useState<StatusPayload>(initial);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, startCancelling] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isRetrying, startRetrying] = useTransition();
  const router = useRouter();

  function handleCancel() {
    setCancelError(null);
    startCancelling(async () => {
      const result = await cancelCompetitionLocatorRun(runId);
      if (result.error) {
        setCancelError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRetryWithOverride() {
    setRetryError(null);
    startRetrying(async () => {
      const result = await retryCompetitionLocatorRunWithOverride(runId);
      if (result.error) {
        setRetryError(result.error);
        return;
      }
      // Optimistic — the polling effect below only resumes once status is
      // no longer terminal, and a server refresh alone wouldn't re-sync
      // this component's own state (only its initial mount reads the
      // initial prop). Same idiom as handleCancel's optimistic update above.
      setStatus((current) => ({ ...current, status: "RUNNING" }));
      router.refresh();
    });
  }

  useEffect(() => {
    if (TERMINAL.has(status.status)) return;

    const interval = setInterval(async () => {
      const response = await fetch(`/api/competition-locator/${runId}/status`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as StatusPayload;
      setStatus(data);
      if (TERMINAL.has(data.status)) {
        router.refresh();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [runId, status.status, router]);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase text-text-muted">Status</p>
        <Badge tone={STATUS_TONE[status.status]} className="text-sm">
          {STATUS_LABEL[status.status]}
        </Badge>
      </div>

      <p className="mt-2 text-text-muted">
        {status.completedRegions} of {status.totalRegions} region{status.totalRegions === 1 ? "" : "s"} complete.
      </p>

      {status.currentActivity && (
        <div className="mt-3 rounded-lg border border-focus/30 bg-focus/5 p-3">
          <p className="text-xs font-semibold uppercase text-text-muted">
            Currently searching: {status.currentActivity.region}, {status.currentActivity.country}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-secondary">
            <Loader2 size={14} className="shrink-0 animate-spin" />
            {status.currentActivity.message ?? "Working..."}
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Possible locations" value={status.found} />
        <StatTile label="Verified" value={status.verified} />
        <StatTile label="Rejected" value={status.rejected} />
        <StatTile label="Needs review" value={status.needsReview} />
        <StatTile label="Possible duplicates" value={status.possibleDuplicates} />
      </div>

      {status.errors.length > 0 && (
        <Alert tone="danger" className="mt-4 space-y-1">
          {status.errors.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </Alert>
      )}

      {status.status === "PARTIAL_FAILURE" && canOverrideBudget && status.errors.some(isBudgetBlockedReason) && (
        <div className="mt-3">
          <Button type="button" variant="primary" onClick={handleRetryWithOverride} disabled={isRetrying}>
            {isRetrying ? "Resuming..." : "Continue anyway"}
          </Button>
          <p className="mt-1 text-xs text-text-muted">Resumes every stopped region from where it left off, bypassing the budget limit for this run only.</p>
          {retryError && <p className="mt-2 text-sm font-semibold text-danger">{retryError}</p>}
        </div>
      )}

      {(status.status === "SUCCEEDED" || status.status === "PARTIAL_FAILURE") && (
        <Link
          href={`/leads/competition-locator/${runId}/review`}
          className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
        >
          Review results
        </Link>
      )}

      {!TERMINAL.has(status.status) && (
        <>
          <p className="mt-3 text-xs text-text-muted">Checking for updates every few seconds — this can take a long time for a broad search.</p>
          <Button type="button" variant="destructive" onClick={handleCancel} disabled={isCancelling} className="mt-4">
            {isCancelling ? "Cancelling..." : "Cancel search"}
          </Button>
          {cancelError && <p className="mt-2 text-sm font-semibold text-danger">{cancelError}</p>}
        </>
      )}
    </Card>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-2xl font-black text-accent">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}
