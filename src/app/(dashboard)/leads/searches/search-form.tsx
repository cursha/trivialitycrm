"use client";

import { useActionState, useState } from "react";
import { startSearch, type SearchFormState } from "./actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
    <form action={formAction}>
    <Card className="space-y-4">
      <div>
        <Label className="mb-1 block text-xs uppercase">Research prompt</Label>
        <Select name="promptId" required>
          <option value="">Choose a prompt...</option>
          {prompts.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label className="mb-1 block text-xs uppercase">Research mode</Label>
        <Select name="mode" value={mode} onChange={(event) => setMode(event.target.value)}>
          {MODES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {mode === "COMPETITOR" && (
        <div>
          <Label className="mb-1 block text-xs uppercase">Competitor</Label>
          <Select name="competitorId" required>
            <option value="">Choose a competitor...</option>
            {competitors.map((competitor) => (
              <option key={competitor.id} value={competitor.id}>
                {competitor.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="mb-1 block text-xs uppercase">Country</Label>
          <Select name="country" required>
            <option value="Canada">Canada</option>
            <option value="United States">United States</option>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block text-xs uppercase">State / Province</Label>
          <Input name="region" required placeholder="e.g. ON or Colorado" />
        </div>
      </div>

      <div>
        <Label className="mb-1 block text-xs uppercase">Cities (optional, comma-separated)</Label>
        <Input
          value={citiesInput}
          onChange={(event) => setCitiesInput(event.target.value)}
          placeholder="Leave blank to search the whole state/province"
        />
        {cities.map((city) => (
          <input key={city} type="hidden" name="cities" value={city} />
        ))}
      </div>

      <div>
        <Label className="mb-1 block text-xs uppercase">Lead Type</Label>
        <Select name="leadTypeId" required>
          <option value="">Choose a Lead Type...</option>
          {leadTypes.map((leadType) => (
            <option key={leadType.id} value={leadType.id}>
              {leadType.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label className="mb-1 block text-xs uppercase">Minimum quality score</Label>
        <Input name="minimumScore" type="number" min={0} max={100} defaultValue={80} className="w-32" />
      </div>

      {state?.error && <FieldError>{state.error}</FieldError>}

      <Button type="submit" disabled={pending} variant="primary">
        {pending ? "Starting..." : "Start search"}
      </Button>
    </Card>
    </form>
  );
}
