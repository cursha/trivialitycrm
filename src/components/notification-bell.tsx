"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { markNotificationRead, markAllNotificationsRead } from "@/app/(dashboard)/notifications-actions";

/** actionHref/actionLabel are set for a REPORT_GENERATED notification whose
 * report succeeded ("Download") and a SCHEDULED_EMAIL_STAGE_SUGGESTED one
 * ("Review", linking to the company's email panel where the suggested
 * pipeline-stage change can be confirmed) — everything else renders as a
 * plain dismissible item. See src/app/(dashboard)/layout.tsx for how this
 * is computed. */
export type Notification = { id: string; message: string; createdAt: string; actionHref?: string; actionLabel?: string };

/** Bespoke small dropdown (not the generic Menu primitive — that one only
 * renders a flat list of clickable actions, not rich per-item content like
 * a download link) — same click-outside/Escape interaction pattern as Menu,
 * scoped to this one use.
 *
 * One unified list backed entirely by the Notification table (Module Six
 * Phase E) — GeneratedReport.seenByIds-driven "report notifications" were
 * a separate section here through Phase D2; Phase E folded report-ready
 * events into Notification (type REPORT_GENERATED) so there's exactly one
 * read-tracking system, not two. */
export function NotificationBell({ notifications }: { notifications: Notification[] }) {
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

  const totalCount = notifications.length;

  if (totalCount === 0) {
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
        aria-label={`${totalCount} unread notification${totalCount === 1 ? "" : "s"}`}
      >
        <Bell size={20} />
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
          {totalCount > 9 ? "9+" : totalCount}
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-border-strong bg-surface-raised py-2 shadow-lg">
          <div className="flex items-center justify-between px-3 pb-2">
            <span className="text-xs font-semibold uppercase text-text-muted">Notifications</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => markAllNotificationsRead())}
              className="text-xs font-semibold text-secondary hover:underline"
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {notifications.map((n) => (
              <li key={n.id} className="px-3 py-1.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-text">{n.message}</span>
                  {n.actionHref ? (
                    <Link
                      href={n.actionHref}
                      onClick={() => startTransition(() => markNotificationRead(n.id))}
                      className="shrink-0 text-xs text-secondary hover:underline"
                    >
                      {n.actionLabel ?? "View"}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startTransition(() => markNotificationRead(n.id))}
                      className="shrink-0 text-xs text-secondary hover:underline"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
                <span className="text-xs text-text-muted">{n.createdAt.slice(0, 16).replace("T", " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
