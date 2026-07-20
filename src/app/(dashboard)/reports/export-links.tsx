"use client";

import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

/**
 * Export links pass through the exact same query-string filters currently
 * applied on screen — the export route re-runs the same scoped query
 * function the page just rendered from, so "export" can never return data
 * the viewer couldn't already see, and the export always matches what's on
 * screen.
 */
export function ExportLinks({ reportKey }: { reportKey: string }) {
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  const base = `/api/reports/${reportKey}/export${qs ? `?${qs}&` : "?"}format=`;

  return (
    <div className="flex items-center gap-3 text-xs font-semibold text-secondary">
      <Download size={14} aria-hidden />
      <a href={`${base}csv`} className="hover:underline">
        Export CSV
      </a>
      <span className="text-text-muted">·</span>
      <a href={`${base}xlsx`} className="hover:underline">
        Export Excel
      </a>
    </div>
  );
}
