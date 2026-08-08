"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelSearch, retrySearchWithBudgetOverride } from "../actions";
import { isBudgetBlockedReason } from "@/lib/ai/budget-messages";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SEARCH_STATUS_TONE, SEARCH_STATUS_LABEL } from "@/lib/ui/status-tones";

type StatusPayload = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  candidatesFound: number;
  progressMessage: string | null;
  errorMessage: string | null;
};

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function SearchStatus({
  searchId,
  initial,
  canOverrideBudget,
  // Every existing caller (which never passes this) keeps the exact same
  // link target as before — only PUB_RADIUS mode's caller overrides it to
  // point at its own dedicated review route (no generic results-table view
  // exists for that mode's duplicate-bucketed review screen).
  resultsHref,
}: {
  searchId: string;
  initial: StatusPayload;
  canOverrideBudget: boolean;
  resultsHref?: string;
}) {
  const [status, setStatus] = useState<StatusPayload>(initial);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, startCancelling] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isRetrying, startRetrying] = useTransition();
  const router = useRouter();

  function handleCancel() {
    setCancelError(null);
    startCancelling(async () => {
      const result = await cancelSearch(searchId);
      if (result.error) {
        setCancelError(result.error);
        return;
      }
      setStatus((current) => ({ ...current, status: "CANCELLED" }));
      router.refresh();
    });
  }

  function handleRetryWithOverride() {
    setRetryError(null);
    startRetrying(async () => {
      const result = await retrySearchWithBudgetOverride(searchId);
      if (result.error) {
        setRetryError(result.error);
        return;
      }
      setStatus((current) => ({ ...current, status: "RUNNING" }));
      router.refresh();
    });
  }

  useEffect(() => {
    if (TERMINAL.has(status.status)) return;

    const interval = setInterval(async () => {
      const response = await fetch(`/api/searches/${searchId}/status`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as StatusPayload;
      setStatus(data);
      if (TERMINAL.has(data.status)) {
        router.refresh();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [searchId, status.status, router]);

  return (
    <Card>
      <p className="text-sm font-semibold uppercase text-text-muted">Status</p>
      <div className="mt-1">
        <Badge tone={SEARCH_STATUS_TONE[status.status]} className="text-sm">
          {SEARCH_STATUS_LABEL[status.status]}
        </Badge>
      </div>
      <p className="mt-2 text-text-muted">{status.candidatesFound} candidate(s) found so far.</p>
      {status.status === "RUNNING" && status.progressMessage && (
        <p className="mt-1 text-sm font-medium text-secondary">{status.progressMessage}</p>
      )}

      {status.status === "FAILED" && status.errorMessage && (
        <Alert tone="danger" className="mt-3">
          {status.errorMessage}
        </Alert>
      )}

      {status.status === "FAILED" && canOverrideBudget && isBudgetBlockedReason(status.errorMessage) && (
        <div className="mt-3">
          <Button type="button" variant="primary" onClick={handleRetryWithOverride} disabled={isRetrying}>
            {isRetrying ? "Resuming..." : "Continue anyway"}
          </Button>
          <p className="mt-1 text-xs text-text-muted">Resumes from where it stopped, bypassing the budget limit for this search only.</p>
          {retryError && <p className="mt-2 text-sm font-semibold text-danger">{retryError}</p>}
        </div>
      )}

      {status.status === "SUCCEEDED" && (
        <Link
          href={resultsHref ?? `/leads/searches/${searchId}/results`}
          className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
        >
          View results
        </Link>
      )}

      {!TERMINAL.has(status.status) && (
        <>
          <p className="mt-3 text-xs text-text-muted">Checking for updates every few seconds...</p>
          <Button type="button" variant="destructive" onClick={handleCancel} disabled={isCancelling} className="mt-4">
            {isCancelling ? "Cancelling..." : "Cancel search"}
          </Button>
          {cancelError && <p className="mt-2 text-sm font-semibold text-danger">{cancelError}</p>}
        </>
      )}
    </Card>
  );
}
