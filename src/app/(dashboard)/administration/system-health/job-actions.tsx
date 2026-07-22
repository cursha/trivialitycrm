"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { retryFailedJob, cancelEligibleJob } from "./actions";

export function JobActions({ queue, jobId, canManage }: { queue: string; jobId: string; canManage: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!canManage) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className="font-semibold text-secondary hover:underline disabled:opacity-50"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await retryFailedJob(queue, jobId);
              if (result?.error) setError(result.error);
              else router.refresh();
            })
          }
        >
          Retry
        </button>
        <button
          type="button"
          className="font-semibold text-danger hover:underline disabled:opacity-50"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm("Cancel this job?")) return;
            startTransition(async () => {
              setError(null);
              const result = await cancelEligibleJob(queue, jobId);
              if (result?.error) setError(result.error);
              else router.refresh();
            });
          }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
