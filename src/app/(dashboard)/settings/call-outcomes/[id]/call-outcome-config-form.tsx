"use client";

import { useActionState, useState } from "react";
import { Input, Select, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { updateCallOutcomeConfig } from "../actions";

type ActionResult = { error?: string } | undefined;
type Option = { id: string; name: string };

export function CallOutcomeConfigForm({
  outcomeId,
  pipelineStages,
  initial,
}: {
  outcomeId: string;
  pipelineStages: Option[];
  initial: {
    requiresNotes: boolean;
    requiresNextAction: boolean;
    defaultNextActionDays: number | null;
    defaultNextActionTitle: string | null;
    defaultPipelineStageId: string | null;
    opensEmailComposer: boolean;
    requiresRejectionReason: boolean;
    skipRestOfSession: boolean;
    appliesDoNotContact: boolean;
    resultCategory: string | null;
  };
}) {
  const action = updateCallOutcomeConfig.bind(null, outcomeId);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>((_prev, formData) => action(formData), undefined);
  const [requiresNextAction, setRequiresNextAction] = useState(initial.requiresNextAction);

  return (
    <form action={formAction} className="space-y-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="requiresNotes" defaultChecked={initial.requiresNotes} />
        Notes are required before saving this outcome
      </label>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="requiresNextAction"
          checked={requiresNextAction}
          onChange={(e) => setRequiresNextAction(e.target.checked)}
        />
        Create a default follow-up when this outcome is recorded
      </label>
      {requiresNextAction && (
        <div className="ml-6 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="defaultNextActionDays">Due in (days from now)</Label>
            <Input id="defaultNextActionDays" name="defaultNextActionDays" type="number" min={0} defaultValue={initial.defaultNextActionDays ?? 3} />
          </div>
          <div>
            <Label htmlFor="defaultNextActionTitle">Follow-up title</Label>
            <Input id="defaultNextActionTitle" name="defaultNextActionTitle" defaultValue={initial.defaultNextActionTitle ?? ""} placeholder="Follow up call" />
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="defaultPipelineStageId">Move company to pipeline stage</Label>
        <Select id="defaultPipelineStageId" name="defaultPipelineStageId" className="w-auto" defaultValue={initial.defaultPipelineStageId ?? ""}>
          <option value="">No stage change</option>
          {pipelineStages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="opensEmailComposer" defaultChecked={initial.opensEmailComposer} />
        Open the email composer after saving this outcome
      </label>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="requiresRejectionReason" defaultChecked={initial.requiresRejectionReason} />
        Require a rejection/loss reason before saving this outcome
      </label>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="skipRestOfSession" defaultChecked={initial.skipRestOfSession} />
        Skip this company for the remainder of the calling session after this outcome
      </label>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="appliesDoNotContact" defaultChecked={initial.appliesDoNotContact} />
        Apply a do-not-contact restriction to the company when this outcome is recorded
      </label>

      <div>
        <Label htmlFor="resultCategory">Session-progress category</Label>
        <Select id="resultCategory" name="resultCategory" className="w-auto" defaultValue={initial.resultCategory ?? ""}>
          <option value="">None</option>
          <option value="UNREACHABLE">Unreachable</option>
          <option value="INTERESTED">Interested</option>
          <option value="DEMO_REQUESTED">Demo requested</option>
          <option value="NOT_INTERESTED">Not interested</option>
        </Select>
      </div>

      {state?.error && <p className="text-xs font-semibold text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save configuration"}
      </Button>
    </form>
  );
}
