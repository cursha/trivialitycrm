"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { updateStagePlaybook, addStageTask, deleteStageTask, type ActionResult } from "../actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea, HelpText, FieldError } from "@/components/ui/field";
import { SALES_TRACK_LABELS } from "@/lib/companies/sales-track";
import type { SalesTrack } from "@/generated/prisma/enums";

type TaskRow = { id: string; title: string; daysAfter: number; track: SalesTrack | null };

export function StageProcessEditor({
  stageId,
  description,
  playbookLocal,
  playbookRemote,
  tasks,
}: {
  stageId: string;
  description: string;
  playbookLocal: string;
  playbookRemote: string;
  tasks: TaskRow[];
}) {
  const router = useRouter();
  const addFormRef = useRef<HTMLFormElement>(null);
  const [playbookError, setPlaybookError] = useState<string | null>(null);
  const [playbookSaved, setPlaybookSaved] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, onError: (message: string | null) => void, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      onError(result?.error ?? null);
      if (!result?.error) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-bold text-accent">Description &amp; checklist</h2>
        <form
          action={(formData) => run(() => updateStagePlaybook(stageId, formData), setPlaybookError, () => setPlaybookSaved(true))}
          onChange={() => setPlaybookSaved(false)}
          className="mt-3 space-y-4"
        >
          <div>
            <Label htmlFor="stage-description">What this step means</Label>
            <Textarea id="stage-description" name="description" rows={3} maxLength={1000} defaultValue={description} className="mt-1" />
            <HelpText className="mt-1">Shown as a bubble when a rep hovers over or taps this step on a company&apos;s Sales process card.</HelpText>
          </div>
          <div>
            <Label htmlFor="playbook-local">{SALES_TRACK_LABELS.LOCAL} bars</Label>
            <Textarea id="playbook-local" name="playbookLocal" rows={5} defaultValue={playbookLocal} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="playbook-remote">{SALES_TRACK_LABELS.REMOTE} bars</Label>
            <Textarea id="playbook-remote" name="playbookRemote" rows={5} defaultValue={playbookRemote} className="mt-1" />
          </div>
          <HelpText>Checklists: one item per line.</HelpText>
          {playbookError && <FieldError>{playbookError}</FieldError>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={isPending}>
              Save
            </Button>
            {playbookSaved && <span className="text-sm text-text-muted">Saved.</span>}
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="font-bold text-accent">Automatic follow-ups</h2>
        <p className="mt-1 text-sm text-text-muted">
          Created for the company&apos;s salesperson when it enters this step. Removing one here doesn&apos;t touch follow-ups it already created.
        </p>

        {tasks.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">None.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold text-text">{task.title}</p>
                  <p className="text-xs text-text-muted">
                    Due {task.daysAfter === 0 ? "the same day" : `${task.daysAfter} day${task.daysAfter === 1 ? "" : "s"} later`} ·{" "}
                    {task.track ? `${SALES_TRACK_LABELS[task.track]} bars only` : "All bars"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => deleteStageTask(task.id), setTaskError)}
                  className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-danger"
                  aria-label={`Remove follow-up "${task.title}"`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          ref={addFormRef}
          action={(formData) => run(() => addStageTask(stageId, formData), setTaskError, () => addFormRef.current?.reset())}
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_7rem_10rem_auto] sm:items-end"
        >
          <div>
            <Label htmlFor="task-title" className="text-xs">
              Follow-up
            </Label>
            <Input id="task-title" name="title" required maxLength={200} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="task-days" className="text-xs">
              Days later
            </Label>
            <Input id="task-days" name="daysAfter" type="number" min={0} max={365} defaultValue={1} required className="mt-1" />
          </div>
          <div>
            <Label htmlFor="task-track" className="text-xs">
              For
            </Label>
            <Select id="task-track" name="track" defaultValue="" className="mt-1">
              <option value="">All bars</option>
              <option value="LOCAL">{SALES_TRACK_LABELS.LOCAL} only</option>
              <option value="REMOTE">{SALES_TRACK_LABELS.REMOTE} only</option>
            </Select>
          </div>
          <Button type="submit" variant="secondary" disabled={isPending}>
            Add
          </Button>
        </form>
        {taskError && <FieldError className="mt-2">{taskError}</FieldError>}
      </Card>
    </div>
  );
}
