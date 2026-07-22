"use client";

import { useActionState } from "react";
import { updateOrganizationSettings } from "./actions";
import { Card, SectionHeading } from "@/components/ui/card";
import { Label, Input, Select, Textarea, HelpText, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { CURRENCY_VALUES, DATE_FORMAT_VALUES } from "@/lib/validation/organization-settings";

export type OrganizationSettingsDefaults = {
  organizationName: string;
  defaultCountry: string;
  defaultRegion: string | null;
  defaultTimezone: string;
  defaultCurrency: string;
  defaultDateFormat: string;
  defaultPipelineStageId: string | null;
  defaultLeadTypeId: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  businessWebsite: string | null;
  businessAddress: string | null;
};

export function OrganizationSettingsForm({
  defaultValues,
  pipelineStages,
  leadTypes,
}: {
  defaultValues: OrganizationSettingsDefaults;
  pipelineStages: { id: string; name: string }[];
  leadTypes: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(updateOrganizationSettings, undefined);

  return (
    <Card>
      <SectionHeading>Organization Settings</SectionHeading>
      <p className="mt-1 text-sm text-text-muted">Single-organization settings — there is no multi-tenancy in this CRM.</p>
      <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Organization name</Label>
          <Input name="organizationName" defaultValue={defaultValues.organizationName} required className="mt-1" />
        </div>
        <div>
          <Label>Default country</Label>
          <Input name="defaultCountry" defaultValue={defaultValues.defaultCountry} required className="mt-1" />
        </div>
        <div>
          <Label>Default state / province (optional)</Label>
          <Input name="defaultRegion" defaultValue={defaultValues.defaultRegion ?? ""} className="mt-1" />
        </div>
        <div>
          <Label>Default time zone</Label>
          <Input name="defaultTimezone" defaultValue={defaultValues.defaultTimezone} placeholder="America/Toronto" required className="mt-1" />
          <HelpText className="mt-1">An IANA time zone name.</HelpText>
        </div>
        <div>
          <Label>Default currency</Label>
          <Select name="defaultCurrency" defaultValue={defaultValues.defaultCurrency} className="mt-1">
            {CURRENCY_VALUES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Default date format</Label>
          <Select name="defaultDateFormat" defaultValue={defaultValues.defaultDateFormat} className="mt-1">
            {DATE_FORMAT_VALUES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
          <HelpText className="mt-1">Stored and validated — not yet applied to every date shown across the app.</HelpText>
        </div>
        <div>
          <Label>Default pipeline stage (optional)</Label>
          <Select name="defaultPipelineStageId" defaultValue={defaultValues.defaultPipelineStageId ?? ""} className="mt-1">
            <option value="">None</option>
            {pipelineStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Default lead type (optional)</Label>
          <Select name="defaultLeadTypeId" defaultValue={defaultValues.defaultLeadTypeId ?? ""} className="mt-1">
            <option value="">None</option>
            {leadTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Business phone (optional)</Label>
          <Input name="businessPhone" defaultValue={defaultValues.businessPhone ?? ""} className="mt-1" />
        </div>
        <div>
          <Label>Business email (optional)</Label>
          <Input name="businessEmail" type="email" defaultValue={defaultValues.businessEmail ?? ""} className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label>Business website (optional)</Label>
          <Input name="businessWebsite" defaultValue={defaultValues.businessWebsite ?? ""} className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label>Business address (optional)</Label>
          <Textarea name="businessAddress" rows={2} defaultValue={defaultValues.businessAddress ?? ""} className="mt-1" />
        </div>
        {state?.error && (
          <div className="sm:col-span-2">
            <FieldError>{state.error}</FieldError>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending} variant="primary">
            {pending ? "Saving…" : "Save organization settings"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
