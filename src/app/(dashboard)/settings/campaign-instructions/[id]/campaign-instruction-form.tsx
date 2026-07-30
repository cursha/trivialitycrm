"use client";

import { useActionState } from "react";
import { Textarea, Label } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { updateCampaignInstructionText } from "../actions";

type ActionResult = { error?: string } | undefined;

export function CampaignInstructionForm({ templateId, initialInstructions }: { templateId: string; initialInstructions: string }) {
  const action = updateCampaignInstructionText.bind(null, templateId);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>((_prev, formData) => action(formData), undefined);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="instructions">Instructions</Label>
        <Textarea id="instructions" name="instructions" rows={10} defaultValue={initialInstructions} placeholder="e.g. Friendly, low-pressure tone. Mention our new trivia night packages. Keep it under 150 words." />
      </div>
      {state?.error && <p className="text-xs font-semibold text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save instructions"}
      </Button>
    </form>
  );
}
