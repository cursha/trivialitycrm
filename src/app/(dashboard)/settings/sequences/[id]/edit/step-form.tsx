"use client";

import { useState, useActionState } from "react";
import { Label, Input, Select, Textarea, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

type ActionResult = { error?: string } | undefined;
type StepType = "WAIT" | "EMAIL" | "TASK" | "CALL_REMINDER" | "DEMO_REMINDER" | "TRIAL_FOLLOWUP";

const TASK_LIKE: StepType[] = ["TASK", "CALL_REMINDER", "DEMO_REMINDER", "TRIAL_FOLLOWUP"];

const TYPE_LABELS: Record<StepType, string> = {
  WAIT: "Wait",
  EMAIL: "Send email",
  TASK: "Task reminder",
  CALL_REMINDER: "Call reminder",
  DEMO_REMINDER: "Demo reminder",
  TRIAL_FOLLOWUP: "Trial follow-up",
};

export function StepForm({
  action,
  templates,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  templates: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [type, setType] = useState<StepType>("WAIT");

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label>Step type</Label>
        <Select name="type" value={type} onChange={(e) => setType(e.target.value as StepType)} className="mt-1">
          {(Object.keys(TYPE_LABELS) as StepType[]).map((value) => (
            <option key={value} value={value}>
              {TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      {type === "WAIT" && (
        <div>
          <Label>Days to wait</Label>
          <Input type="number" name="waitDays" min={1} required className="mt-1" placeholder="3" />
        </div>
      )}

      {type === "EMAIL" && (
        <div>
          <Label>Shared template</Label>
          <Select name="emailTemplateId" required defaultValue="" className="mt-1">
            <option value="" disabled>
              Choose a shared template
            </option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
          {templates.length === 0 && (
            <p className="mt-1 text-xs text-danger">No active shared templates exist yet — create one from Settings → Email Templates.</p>
          )}
        </div>
      )}

      {TASK_LIKE.includes(type) && (
        <>
          <div>
            <Label>Task title (optional)</Label>
            <Input name="taskTitle" className="mt-1" placeholder={TYPE_LABELS[type]} />
          </div>
          <div className="sm:col-span-2">
            <Label>Task notes (optional)</Label>
            <Textarea name="taskNotes" rows={2} className="mt-1" />
          </div>
        </>
      )}

      {state?.error && (
        <div className="sm:col-span-2">
          <FieldError>{state.error}</FieldError>
        </div>
      )}

      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending} className="px-6 py-2.5">
          {pending ? "Adding..." : "Add step"}
        </Button>
      </div>
    </form>
  );
}
