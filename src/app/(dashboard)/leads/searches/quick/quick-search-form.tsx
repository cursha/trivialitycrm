"use client";

import { useActionState, useState } from "react";
import { startQuickSearch, type QuickSearchFormState } from "./actions";
import { Card } from "@/components/ui/card";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export type QuickSearchFormOptions = {
  leadTypes: { id: string; name: string }[];
};

export function QuickSearchForm({ leadTypes }: QuickSearchFormOptions) {
  const [state, formAction, pending] = useActionState<QuickSearchFormState, FormData>(startQuickSearch, undefined);
  const [citiesInput, setCitiesInput] = useState("");

  const cities = citiesInput
    .split(",")
    .map((city) => city.trim())
    .filter(Boolean);

  return (
    <form action={formAction}>
      <Card className="space-y-4">
        <div>
          <Label className="mb-1 block text-xs uppercase">Venue types</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {leadTypes.map((leadType) => (
              <label key={leadType.id} className="flex items-center gap-2 rounded-lg border border-border-strong px-3 py-2 text-sm text-text">
                <input type="checkbox" name="leadTypeIds" value={leadType.id} />
                {leadType.name}
              </label>
            ))}
          </div>
          {leadTypes.length === 0 && <p className="text-sm text-text-muted">No active Lead Types configured yet.</p>}
        </div>

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

        {state?.error && <FieldError>{state.error}</FieldError>}

        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Starting..." : "List locations"}
        </Button>
      </Card>
    </form>
  );
}
