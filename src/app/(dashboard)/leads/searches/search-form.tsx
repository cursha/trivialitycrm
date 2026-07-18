"use client";

import { useActionState, useState } from "react";
import { startSearch, type SearchFormState } from "./actions";

export type SearchFormOptions = {
  prompts: { id: string; name: string }[];
  leadTypes: { id: string; name: string }[];
  competitors: { id: string; name: string }[];
};

const MODES = [
  { value: "GENERAL", label: "General — match the prompt's criteria" },
  { value: "TRIVIA_GAP", label: "Offers events but not trivia" },
  { value: "TRIVIA_CONFIRMED", label: "Currently offers trivia" },
  { value: "COMPETITOR", label: "Competitor research" },
];

export function SearchForm({ prompts, leadTypes, competitors }: SearchFormOptions) {
  const [state, formAction, pending] = useActionState<SearchFormState, FormData>(startSearch, undefined);
  const [mode, setMode] = useState("GENERAL");
  const [citiesInput, setCitiesInput] = useState("");

  const cities = citiesInput
    .split(",")
    .map((city) => city.trim())
    .filter(Boolean);

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Research prompt</label>
        <select name="promptId" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Choose a prompt...</option>
          {prompts.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Research mode</label>
        <select
          name="mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {MODES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {mode === "COMPETITOR" && (
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Competitor</label>
          <select name="competitorId" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Choose a competitor...</option>
            {competitors.map((competitor) => (
              <option key={competitor.id} value={competitor.id}>
                {competitor.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Country</label>
          <select name="country" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="Canada">Canada</option>
            <option value="United States">United States</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">State / Province</label>
          <input name="region" required placeholder="e.g. ON or Colorado" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Cities (optional, comma-separated)</label>
        <input
          value={citiesInput}
          onChange={(event) => setCitiesInput(event.target.value)}
          placeholder="Leave blank to search the whole state/province"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {cities.map((city) => (
          <input key={city} type="hidden" name="cities" value={city} />
        ))}
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Lead Type</label>
        <select name="leadTypeId" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Choose a Lead Type...</option>
          {leadTypes.map((leadType) => (
            <option key={leadType.id} value={leadType.id}>
              {leadType.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">Minimum quality score</label>
        <input
          name="minimumScore"
          type="number"
          min={0}
          max={100}
          defaultValue={80}
          className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {state?.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}

      <button type="submit" disabled={pending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
        {pending ? "Starting..." : "Start search"}
      </button>
    </form>
  );
}
