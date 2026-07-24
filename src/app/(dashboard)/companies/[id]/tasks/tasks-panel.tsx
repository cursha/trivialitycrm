"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Check, X } from "lucide-react";
import { createTask, completeTask, cancelTask } from "./actions";
import { useQuickActions } from "../quick-action-context";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field";

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: Date;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  completedAt: Date | null;
  assignedTo: { id: string; name: string };
};

type SalespersonOption = { id: string; name: string };

export function TasksPanel({
  companyId,
  tasks,
  salespeople,
  canManage,
}: {
  companyId: string;
  tasks: TaskRow[];
  salespeople: SalespersonOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { registerFollowUpHandler } = useQuickActions();
  const [adding, setAdding] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [addNext, setAddNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!canManage) return;
    return registerFollowUpHandler(() => setAdding(true));
  }, [canManage, registerFollowUpHandler]);

  const openTasks = tasks.filter((t) => t.status === "OPEN");
  const closedTasks = tasks.filter((t) => t.status !== "OPEN");

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await createTask(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setAdding(false);
        router.refresh();
      }
    });
  }

  function handleComplete(taskId: string, formData: FormData) {
    startTransition(async () => {
      const result = await completeTask(companyId, taskId, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setCompletingId(null);
        setAddNext(false);
        router.refresh();
      }
    });
  }

  function handleCancel(taskId: string) {
    if (!window.confirm("Cancel this follow-up?")) return;
    startTransition(async () => {
      const result = await cancelTask(companyId, taskId);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-accent">Follow-ups</h2>
        {canManage && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Add follow-up
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-danger">{error}</p>}

      {adding && (
        <form action={handleCreate} className="mt-3 space-y-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3">
          <Input name="title" placeholder="Title" required autoFocus className="py-1.5" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input name="dueAt" type="date" required className="py-1.5" />
            <Select name="assignedToId" required defaultValue="" className="py-1.5">
              <option value="" disabled>
                Assigned salesperson
              </option>
              {salespeople.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <Textarea name="notes" placeholder="Notes" rows={2} className="py-1.5" />
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50">
              {isPending ? "Saving..." : "Add"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5">
              Cancel
            </button>
          </div>
        </form>
      )}

      {openTasks.length === 0 && !adding && <p className="mt-3 text-sm text-text-muted">No open follow-ups.</p>}

      <ul className="mt-3 space-y-2">
        {openTasks.map((task) => (
          <li key={task.id} className="rounded-lg border border-border p-3 text-sm">
            {completingId === task.id ? (
              <form action={(formData) => handleComplete(task.id, formData)} className="space-y-2">
                <p className="font-semibold text-text">Complete &quot;{task.title}&quot;</p>
                <label className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                  <input
                    type="checkbox"
                    name="createNext"
                    value="true"
                    checked={addNext}
                    onChange={(e) => setAddNext(e.target.checked)}
                  />
                  Create the next follow-up
                </label>
                {addNext && (
                  <div className="space-y-2 rounded-lg bg-black/[0.02] p-2">
                    <Input name="next-title" placeholder="Next follow-up title" required={addNext} className="py-1.5" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input name="next-dueAt" type="date" required={addNext} className="py-1.5" />
                      <Select name="next-assignedToId" required={addNext} defaultValue={task.assignedTo.id} className="py-1.5">
                        {salespeople.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Textarea name="next-notes" placeholder="Notes" rows={2} className="py-1.5" />
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="submit" disabled={isPending} className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:pointer-events-none disabled:opacity-50">
                    <Check size={13} />
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCompletingId(null);
                      setAddNext(false);
                    }}
                    className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-text">{task.title}</p>
                  <p className="text-xs text-text-muted">
                    Due {new Date(task.dueAt).toLocaleDateString()} · {task.assignedTo.name}
                  </p>
                  {task.notes && <p className="mt-1 text-text-muted">{task.notes}</p>}
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => setCompletingId(task.id)}
                      className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50"
                      aria-label={`Complete ${task.title}`}
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleCancel(task.id)}
                      className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label={`Cancel ${task.title}`}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {closedTasks.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-text-muted">
            {closedTasks.length} completed/cancelled
          </summary>
          <ul className="mt-2 space-y-2">
            {closedTasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-border p-3 text-sm text-text-muted">
                <p className={task.status === "COMPLETED" ? "line-through" : ""}>{task.title}</p>
                <p className="text-xs">
                  {task.status === "COMPLETED" && task.completedAt
                    ? `Completed ${new Date(task.completedAt).toLocaleDateString()}`
                    : "Cancelled"}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
