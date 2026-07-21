"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";
import { setScheduledReportActive, deleteScheduledReport } from "./actions";

const CADENCE_LABELS: Record<string, string> = { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly" };

type ScheduleRowData = {
  id: string;
  name: string;
  reportLabel: string;
  cadence: string;
  recipientCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string;
  active: boolean;
  createdByName: string;
};

function formatDate(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

export function ScheduledReportRow({ schedule }: { schedule: ScheduleRowData }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`Delete the schedule "${schedule.name}"? This cannot be undone.`)) return;
    startTransition(() => deleteScheduledReport(schedule.id));
  }

  return (
    <tr className="border-t border-border/40 align-top">
      <td className="py-2 font-medium text-text">
        {schedule.name}
        <div className="text-xs text-text-muted">by {schedule.createdByName}</div>
      </td>
      <td className="py-2 text-text">{schedule.reportLabel}</td>
      <td className="py-2 text-text">{CADENCE_LABELS[schedule.cadence] ?? schedule.cadence}</td>
      <td className="py-2 text-text">{schedule.recipientCount}</td>
      <td className="py-2 text-text-muted">
        {schedule.lastRunAt ? (
          <>
            {formatDate(schedule.lastRunAt)}
            {schedule.lastRunStatus === "FAILED" && <span className="ml-1 text-danger">(failed)</span>}
          </>
        ) : (
          "Never"
        )}
      </td>
      <td className="py-2 text-text-muted">{formatDate(schedule.nextRunAt)}</td>
      <td className="py-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => setScheduledReportActive(schedule.id, !schedule.active))}
        >
          <Badge tone={ACTIVE_TONE[schedule.active ? "active" : "inactive"]}>{schedule.active ? "Active" : "Paused"}</Badge>
        </button>
      </td>
      <td className="py-2 text-right">
        <button
          type="button"
          disabled={isPending}
          onClick={handleDelete}
          className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
          aria-label={`Delete ${schedule.name}`}
        >
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  );
}
