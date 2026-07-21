"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { moveSequenceStep, deleteSequenceStep } from "../../actions";

export type StepRowData = {
  id: string;
  stepOrder: number;
  type: string;
  waitDays: number | null;
  emailTemplateName: string | null;
  taskTitle: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  WAIT: "Wait",
  EMAIL: "Send email",
  TASK: "Task reminder",
  CALL_REMINDER: "Call reminder",
  DEMO_REMINDER: "Demo reminder",
  TRIAL_FOLLOWUP: "Trial follow-up",
};

function describeStep(step: StepRowData): string {
  if (step.type === "WAIT") return `Wait ${step.waitDays ?? 0} day(s)`;
  if (step.type === "EMAIL") return `Send "${step.emailTemplateName ?? "(template deleted)"}"`;
  return step.taskTitle || TYPE_LABELS[step.type] || step.type;
}

export function StepRow({
  sequenceId,
  step,
  isFirst,
  isLast,
  locked,
}: {
  sequenceId: string;
  step: StepRowData;
  isFirst: boolean;
  isLast: boolean;
  locked: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleMove(direction: "up" | "down") {
    startTransition(async () => {
      const result = await moveSequenceStep(sequenceId, step.id, direction);
      if (result?.error) setError(result.error);
    });
  }

  function handleDelete() {
    if (!window.confirm("Remove this step?")) return;
    startTransition(async () => {
      const result = await deleteSequenceStep(sequenceId, step.id);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <span className="mr-2 text-xs font-semibold text-text-muted">#{step.stepOrder}</span>
          <span className="font-semibold text-text">{TYPE_LABELS[step.type] ?? step.type}</span>
          <span className="ml-2 text-text-muted">— {describeStep(step)}</span>
        </div>
        {!locked && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={isPending || isFirst}
              onClick={() => handleMove("up")}
              className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text disabled:pointer-events-none disabled:opacity-30"
              aria-label="Move up"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              disabled={isPending || isLast}
              onClick={() => handleMove("down")}
              className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text disabled:pointer-events-none disabled:opacity-30"
              aria-label="Move down"
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={handleDelete}
              className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
              aria-label="Remove step"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-danger">{error}</p>}
    </li>
  );
}
