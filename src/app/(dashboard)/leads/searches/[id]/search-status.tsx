"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type StatusPayload = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  candidatesFound: number;
  errorMessage: string | null;
};

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function SearchStatus({ searchId, initial }: { searchId: string; initial: StatusPayload }) {
  const [status, setStatus] = useState<StatusPayload>(initial);
  const router = useRouter();

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
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase text-slate-500">Status</p>
      <p className="mt-1 text-2xl font-black">{status.status}</p>
      <p className="mt-2 text-slate-500">{status.candidatesFound} candidate(s) found so far.</p>

      {status.status === "FAILED" && status.errorMessage && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{status.errorMessage}</p>
      )}

      {status.status === "SUCCEEDED" && (
        <Link href={`/leads/searches/${searchId}/results`} className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">
          View results
        </Link>
      )}

      {!TERMINAL.has(status.status) && <p className="mt-3 text-xs text-slate-400">Checking for updates every few seconds...</p>}
    </div>
  );
}
