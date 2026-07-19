"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { refinePrompt, type PromptFormState } from "./actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Textarea, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function PromptForm({
  action,
  initialName = "",
  initialPrompt = "",
  submitLabel = "Save prompt",
}: {
  action: (prevState: PromptFormState, formData: FormData) => Promise<PromptFormState>;
  initialName?: string;
  initialPrompt?: string;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [description, setDescription] = useState("");
  const [assistError, setAssistError] = useState<string | undefined>();
  const [isAssisting, startAssist] = useTransition();

  function handleAssist() {
    if (!description.trim()) {
      setAssistError("Describe what you'd like the AI to research or improve first.");
      return;
    }
    setAssistError(undefined);
    startAssist(async () => {
      const fd = new FormData();
      fd.set("description", description);
      fd.set("currentPrompt", prompt);
      const result = await refinePrompt(undefined, fd);
      if (result?.error) {
        setAssistError(result.error);
      } else if (result?.prompt) {
        setPrompt(result.prompt);
      }
    });
  }

  return (
    <form action={formAction}>
    <Card className="space-y-4">
      <div>
        <Label className="mb-1 block text-xs uppercase">Name</Label>
        <Input name="name" defaultValue={initialName} required />
      </div>

      <div className="rounded-xl border border-dashed border-border-strong bg-black/[0.02] p-3">
        <Label className="mb-1 block text-xs uppercase">Describe what you want (AI assist)</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Bars that host live music but haven't added trivia yet"
            className="flex-1"
          />
          <Button type="button" variant="secondary" onClick={handleAssist} disabled={isAssisting} className="whitespace-nowrap">
            <Sparkles size={16} />
            {isAssisting ? "Thinking..." : prompt ? "Improve prompt" : "Draft prompt"}
          </Button>
        </div>
        {assistError && <FieldError className="mt-2">{assistError}</FieldError>}
      </div>

      <div>
        <Label className="mb-1 block text-xs uppercase">Research prompt</Label>
        <Textarea
          name="qualificationPrompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          required
          rows={8}
        />
        <p className="mt-1 text-xs text-text-muted">
          This prompt is saved independently of location and Lead Type — reuse it across different searches.
        </p>
      </div>

      {state?.error && <FieldError>{state.error}</FieldError>}

      <Button type="submit" disabled={pending} variant="primary">
        {pending ? "Saving..." : submitLabel}
      </Button>
    </Card>
    </form>
  );
}
