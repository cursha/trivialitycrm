"use client";

import { useActionState } from "react";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { createSequence } from "./actions";

export function CreateSequenceForm({ pipelineStages }: { pipelineStages: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createSequence, undefined);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label>Name</Label>
        <Input name="name" required className="mt-1" placeholder="New lead nurture" />
      </div>
      <div>
        <Label>Stop if this stage is reached (optional)</Label>
        <Select name="stopOnPipelineStageId" defaultValue="" className="mt-1">
          <option value="">Never stop on stage</option>
          {pipelineStages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </Select>
      </div>
      {state?.error && (
        <div className="sm:col-span-2">
          <FieldError>{state.error}</FieldError>
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending} className="px-6 py-2.5">
          {pending ? "Creating..." : "Create sequence"}
        </Button>
      </div>
    </form>
  );
}
