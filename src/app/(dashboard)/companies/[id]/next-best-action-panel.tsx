"use client";

import Link from "next/link";
import { CircleCheck } from "lucide-react";
import type { NextBestActionItem } from "@/lib/workspace/next-best-action";
import { useQuickActions } from "./quick-action-context";
import { Card } from "@/components/ui/card";

function scrollToPanel(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function NextBestActionPanel({ items, canEdit }: { items: NextBestActionItem[]; canEdit: boolean }) {
  const { requestActivity, requestFollowUp } = useQuickActions();

  return (
    <Card>
      <h2 className="font-bold text-accent">Next best action</h2>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-text-muted">
          <CircleCheck size={16} className="text-emerald-600" />
          Nothing urgent — this company is in good shape.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map((item) => (
            <li key={item.code} className="flex items-start justify-between gap-3 rounded-lg border border-border-strong p-3">
              <div>
                <p className="text-sm font-semibold text-text">{item.label}</p>
                <p className="text-xs text-text-muted">{item.reason}</p>
              </div>
              {canEdit && <NextBestActionButton item={item} onScrollTo={scrollToPanel} onRequestActivity={requestActivity} onRequestFollowUp={requestFollowUp} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NextBestActionButton({
  item,
  onScrollTo,
  onRequestActivity,
  onRequestFollowUp,
}: {
  item: NextBestActionItem;
  onScrollTo: (id: string) => void;
  onRequestActivity: (type: string) => void;
  onRequestFollowUp: () => void;
}) {
  const buttonClass = "shrink-0 whitespace-nowrap rounded-lg border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5";

  switch (item.code) {
    case "OVERDUE_FOLLOW_UP":
      return (
        <button type="button" onClick={() => onScrollTo("tasks-panel")} className={buttonClass}>
          View follow-ups
        </button>
      );
    case "PENDING_DUPLICATE":
      return (
        <Link href="/data-quality/duplicates?entityType=COMPANY" className={buttonClass}>
          Review duplicates
        </Link>
      );
    case "NO_CONTACT":
      return (
        <button type="button" onClick={() => onScrollTo("contacts-panel")} className={buttonClass}>
          Add contact
        </button>
      );
    case "TRIAL_NEEDS_REVIEW":
    case "NO_FOLLOW_UP_SCHEDULED":
      return (
        <button type="button" onClick={onRequestFollowUp} className={buttonClass}>
          Schedule follow-up
        </button>
      );
    case "NO_RECENT_ACTIVITY":
      return (
        <button type="button" onClick={() => onRequestActivity("NOTE")} className={buttonClass}>
          Log activity
        </button>
      );
  }
}
