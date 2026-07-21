"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { markGeneratedReportSeen, markAllGeneratedReportsSeen } from "@/app/(dashboard)/reports/scheduled/actions";

export type UnseenReportNotification = { id: string; name: string; status: string; createdAt: string };

/** Bespoke small dropdown (not the generic Menu primitive — that one only
 * renders a flat list of clickable actions, not rich per-item content like
 * a status badge + download link) — same click-outside/Escape interaction
 * pattern as Menu, scoped to this one use. */
export function NotificationBell({ notifications }: { notifications: UnseenReportNotification[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (notifications.length === 0) {
    return (
      <div className="relative rounded-lg p-2 text-text-muted" aria-hidden="true">
        <Bell size={20} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative rounded-lg p-2 text-text hover:bg-black/5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${notifications.length} unread report notification${notifications.length === 1 ? "" : "s"}`}
      >
        <Bell size={20} />
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
          {notifications.length > 9 ? "9+" : notifications.length}
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-border-strong bg-surface-raised py-2 shadow-lg">
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-xs font-semibold uppercase text-text-muted">Report notifications</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => markAllGeneratedReportsSeen())}
              className="text-xs font-semibold text-secondary hover:underline"
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {notifications.map((n) => (
              <li key={n.id} className="px-3 py-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{n.name}</span>
                  <span className={n.status === "FAILED" ? "text-xs font-semibold text-danger" : "text-xs font-semibold text-secondary"}>
                    {n.status === "FAILED" ? "Failed" : "Ready"}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-xs text-text-muted">
                  <span>{n.createdAt.slice(0, 16).replace("T", " ")}</span>
                  {n.status === "SUCCEEDED" ? (
                    <Link
                      href={`/api/reports/generated/${n.id}/download?format=csv`}
                      onClick={() => startTransition(() => markGeneratedReportSeen(n.id))}
                      className="text-secondary hover:underline"
                    >
                      Download
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startTransition(() => markGeneratedReportSeen(n.id))}
                      className="text-secondary hover:underline"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
