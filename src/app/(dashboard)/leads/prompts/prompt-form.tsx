"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { refinePrompt, type PromptFormState } from "./actions";

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
    <form action={formAction} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Name</label>
        <input
          name="name"
          defaultValue={initialName}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
          Describe what you want (AI assist)
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Bars that host live music but haven't added trivia yet"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
          <button
            type="button"
            onClick={handleAssist}
            disabled={isAssisting}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            <Sparkles size={16} />
            {isAssisting ? "Thinking..." : prompt ? "Improve prompt" : "Draft prompt"}
          </button>
        </div>
        {assistError && <p className="mt-2 text-xs font-semibold text-red-600">{assistError}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Research prompt</label>
        <textarea
          name="qualificationPrompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          required
          rows={8}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
        <p className="mt-1 text-xs text-slate-500">
          This prompt is saved independently of location and Lead Type — reuse it across different searches.
        </p>
      </div>

      {state?.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}

      <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
        {pending ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
