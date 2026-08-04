"use client";

import { useActionState, useState } from "react";
import { startCompetitionLocatorRun, type CompetitionLocatorFormState } from "./actions";
import { US_STATES, CA_PROVINCES } from "@/lib/constants/north-american-regions";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Label, Select, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export type CompetitionLocatorFormOptions = {
  competitors: { id: string; name: string }[];
  leadTypes: { id: string; name: string }[];
  canOverrideBudget: boolean;
};

// Encodes each checkbox as "Country|CODE" so a plain FormData.getAll() round
// trip carries both without a nested-object form encoding scheme.
function regionValue(country: "United States" | "Canada", code: string): string {
  return `${country}|${code}`;
}

export function CompetitionLocatorForm({ competitors, leadTypes, canOverrideBudget }: CompetitionLocatorFormOptions) {
  const [state, formAction, pending] = useActionState<CompetitionLocatorFormState, FormData>(startCompetitionLocatorRun, undefined);
  const [selectedCount, setSelectedCount] = useState(0);

  return (
    <form
      action={formAction}
      onChange={(event) => {
        const form = event.currentTarget;
        setSelectedCount(form.querySelectorAll('input[name="regions"]:checked').length);
      }}
    >
      <Card className="space-y-4">
        <div>
          <Label className="mb-1 block text-xs uppercase">Competitor</Label>
          <Select name="competitorId" required defaultValue="">
            <option value="" disabled>
              Choose a competitor...
            </option>
            {competitors.map((competitor) => (
              <option key={competitor.id} value={competitor.id}>
                {competitor.name}
              </option>
            ))}
          </Select>
          {competitors.length === 0 && <p className="mt-1 text-sm text-text-muted">No active competitors configured yet.</p>}
        </div>

        <div>
          <Label className="mb-1 block text-xs uppercase">Lead Type</Label>
          <Select name="leadTypeId" required defaultValue="">
            <option value="" disabled>
              Choose a Lead Type...
            </option>
            {leadTypes.map((leadType) => (
              <option key={leadType.id} value={leadType.id}>
                {leadType.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="mb-1 block text-xs uppercase">
            Limit to specific states/provinces (optional — {selectedCount > 0 ? `${selectedCount} selected` : "none selected = search broadly"})
          </Label>
          <details className="mt-1 rounded-lg border border-border-strong">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-text">Choose states / provinces</summary>
            <div className="space-y-3 border-t border-border p-3">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-text-muted">United States</p>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
                  {US_STATES.map((state) => (
                    <label key={state.code} className="flex items-center gap-1.5 text-xs text-text">
                      <input type="checkbox" name="regions" value={regionValue("United States", state.code)} />
                      {state.code}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-text-muted">Canada</p>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
                  {CA_PROVINCES.map((province) => (
                    <label key={province.code} className="flex items-center gap-1.5 text-xs text-text">
                      <input type="checkbox" name="regions" value={regionValue("Canada", province.code)} />
                      {province.code}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>

        <Alert tone="warning">
          {selectedCount > 0
            ? `Runs in the background across ${selectedCount} state${selectedCount === 1 ? "" : "s"}/province${selectedCount === 1 ? "" : "s"}, one at a time.`
            : "Leaving states/provinces unchecked searches broadly across all of Canada and the United States — this runs one region at a time in the background and can take a long time (realistically hours) to fully complete. Narrow to specific states/provinces above for a faster, cheaper run."}
        </Alert>

        {state?.error && <FieldError>{state.error}</FieldError>}

        {state?.budgetBlocked && canOverrideBudget && (
          <label className="flex items-center gap-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3 text-sm text-text">
            <input type="checkbox" name="overrideBudget" value="true" />
            Continue anyway — start this run despite the budget limit above.
          </label>
        )}

        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Starting..." : "Start search"}
        </Button>
      </Card>
    </form>
  );
}
