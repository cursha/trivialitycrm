"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, Check, X } from "lucide-react";
import { createTask, completeTask, cancelTask } from "./actions";

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
  const [adding, setAdding] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [addNext, setAddNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

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
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Follow-ups</h2>
        {canManage && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline"
          >
            <CirclePlus size={15} />
            Add follow-up
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}

      {adding && (
        <form action={handleCreate} className="mt-3 space-y-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
          <input name="title" placeholder="Title" required autoFocus className={inputClass} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="dueAt" type="date" required className={inputClass} />
            <select name="assignedToId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Assigned salesperson
              </option>
              {salespeople.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <textarea name="notes" placeholder="Notes" rows={2} className={inputClass} />
          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">
              {isPending ? "Saving..." : "Add"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold">
              Cancel
            </button>
          </div>
        </form>
      )}

      {openTasks.length === 0 && !adding && <p className="mt-3 text-sm text-slate-500">No open follow-ups.</p>}

      <ul className="mt-3 space-y-2">
        {openTasks.map((task) => (
          <li key={task.id} className="rounded-lg border border-slate-100 p-3 text-sm">
            {completingId === task.id ? (
              <form action={(formData) => handleComplete(task.id, formData)} className="space-y-2">
                <p className="font-semibold">Complete &quot;{task.title}&quot;</p>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
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
                  <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                    <input name="next-title" placeholder="Next follow-up title" required={addNext} className={inputClass} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input name="next-dueAt" type="date" required={addNext} className={inputClass} />
                      <select name="next-assignedToId" required={addNext} defaultValue={task.assignedTo.id} className={inputClass}>
                        {salespeople.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea name="next-notes" placeholder="Notes" rows={2} className={inputClass} />
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="submit" disabled={isPending} className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                    <Check size={13} />
                    Complete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCompletingId(null);
                      setAddNext(false);
                    }}
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{task.title}</p>
                  <p className="text-xs text-slate-500">
                    Due {new Date(task.dueAt).toLocaleDateString()} · {task.assignedTo.name}
                  </p>
                  {task.notes && <p className="mt-1 text-slate-600">{task.notes}</p>}
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
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
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
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">
            {closedTasks.length} completed/cancelled
          </summary>
          <ul className="mt-2 space-y-2">
            {closedTasks.map((task) => (
              <li key={task.id} className="rounded-lg border border-slate-100 p-3 text-sm text-slate-500">
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
    </div>
  );
}
