"use client";

import { useActionState } from "react";
import { updateAiSettings } from "./actions";
import { Card, SectionHeading } from "@/components/ui/card";
import { Label, Input, Select, HelpText, FieldError } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { APPROVED_MODEL_OPTIONS } from "@/lib/ai/models";

export type AiSettingsDefaults = {
  researchEnabled: boolean;
  approvedModel: string;
  defaultMinimumScore: number;
  maxCitiesPerSearch: number;
  maxResultsPerSearch: number | null;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  warningThresholdUsd: number | null;
  perUserDailySearchLimit: number | null;
  maxCostPerSearchUsd: number | null;
};

export function AiSettingsForm({
  defaultValues,
  providerMode,
  apiKeyConfigured,
}: {
  defaultValues: AiSettingsDefaults;
  providerMode: string;
  apiKeyConfigured: boolean;
}) {
  const [state, action, pending] = useActionState(updateAiSettings, undefined);

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-center gap-3">
        <Badge tone={providerMode === "mock" ? "neutral" : "focus"}>{providerMode === "mock" ? "Mock — test data only, never mistaken for live research" : "Anthropic — live"}</Badge>
        <Badge tone={apiKeyConfigured ? "success" : "warning"}>{apiKeyConfigured ? "API key configured" : "API key not configured"}</Badge>
        <p className="w-full text-xs text-text-muted">Provider mode and the API key itself are set via environment configuration, not here — the key&apos;s value is never stored or shown in the app.</p>
      </Card>

      <Card>
        <SectionHeading>AI Settings</SectionHeading>
        <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" id="researchEnabled" name="researchEnabled" defaultChecked={defaultValues.researchEnabled} className="h-4 w-4 accent-secondary" />
            <Label htmlFor="researchEnabled">AI research enabled</Label>
          </div>
          <div>
            <Label>Approved model</Label>
            <Select name="approvedModel" defaultValue={defaultValues.approvedModel} className="mt-1">
              {APPROVED_MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Default minimum lead score</Label>
            <Input name="defaultMinimumScore" type="number" min={0} max={100} defaultValue={defaultValues.defaultMinimumScore} required className="mt-1" />
          </div>
          <div>
            <Label>Maximum cities per search</Label>
            <Input name="maxCitiesPerSearch" type="number" min={1} max={50} defaultValue={defaultValues.maxCitiesPerSearch} required className="mt-1" />
          </div>
          <div>
            <Label>Maximum results per search (optional)</Label>
            <Input name="maxResultsPerSearch" type="number" min={1} defaultValue={defaultValues.maxResultsPerSearch ?? ""} className="mt-1" />
            <HelpText className="mt-1">Leave blank for unlimited.</HelpText>
          </div>
          <div>
            <Label>Daily budget (USD, optional)</Label>
            <Input name="dailyBudgetUsd" type="number" min={0} step="0.01" defaultValue={defaultValues.dailyBudgetUsd ?? ""} className="mt-1" />
          </div>
          <div>
            <Label>Monthly budget (USD, optional)</Label>
            <Input name="monthlyBudgetUsd" type="number" min={0} step="0.01" defaultValue={defaultValues.monthlyBudgetUsd ?? ""} className="mt-1" />
          </div>
          <div>
            <Label>Warning threshold (USD, optional)</Label>
            <Input name="warningThresholdUsd" type="number" min={0} step="0.01" defaultValue={defaultValues.warningThresholdUsd ?? ""} className="mt-1" />
            <HelpText className="mt-1">Shown as a caution on the Administration home page — does not block new searches.</HelpText>
          </div>
          <div>
            <Label>Per-user daily search limit (optional)</Label>
            <Input name="perUserDailySearchLimit" type="number" min={1} defaultValue={defaultValues.perUserDailySearchLimit ?? ""} className="mt-1" />
            <HelpText className="mt-1">Leave blank for unlimited.</HelpText>
          </div>
          <div>
            <Label>Maximum cost per search (USD, optional)</Label>
            <Input name="maxCostPerSearchUsd" type="number" min={0} step="0.01" defaultValue={defaultValues.maxCostPerSearchUsd ?? ""} className="mt-1" />
            <HelpText className="mt-1">Rechecked between candidates while a search runs — stops the search immediately if crossed mid-run, not just at start. Leave blank for unlimited.</HelpText>
          </div>
          {state?.error && (
            <div className="sm:col-span-2">
              <FieldError>{state.error}</FieldError>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending} variant="primary">
              {pending ? "Saving…" : "Save AI settings"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
