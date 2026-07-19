"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import type { CompanyFormState } from "./actions";
import { Label, Input, Select, Textarea, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type Option = { id: string; name: string };

export function CompanyForm({
  action,
  defaultValues,
  leadTypes,
  pipelineStages,
  competitors,
  salespeople,
  isAdmin,
  submitLabel,
}: {
  action: (prevState: CompanyFormState, formData: FormData) => Promise<CompanyFormState>;
  defaultValues?: {
    name?: string;
    address1?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
    email?: string;
    websiteUrl?: string;
    leadTypeId?: string;
    pipelineStageId?: string;
    competitorId?: string;
    assignedToId?: string;
    triviaStatus?: string;
    notes?: string;
    nextFollowUpAt?: string;
  };
  leadTypes: Option[];
  pipelineStages: Option[];
  competitors: Option[];
  salespeople: Option[];
  isAdmin: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const overrideRef = useRef<HTMLInputElement>(null);

  return (
    <form action={formAction} className="space-y-6">
      <input ref={overrideRef} type="hidden" name="overrideDuplicates" defaultValue="false" />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Company name</Label>
          <Input name="name" defaultValue={defaultValues?.name} required className="mt-1" />
        </div>

        <div className="sm:col-span-2">
          <Label>Street address</Label>
          <Input name="address1" defaultValue={defaultValues?.address1} className="mt-1" />
        </div>

        <div>
          <Label>City</Label>
          <Input name="city" defaultValue={defaultValues?.city} required className="mt-1" />
        </div>
        <div>
          <Label>State / Province</Label>
          <Input name="region" defaultValue={defaultValues?.region} required className="mt-1" />
        </div>
        <div>
          <Label>ZIP / Postal code</Label>
          <Input name="postalCode" defaultValue={defaultValues?.postalCode} className="mt-1" />
        </div>
        <div>
          <Label>Country</Label>
          <Input name="country" defaultValue={defaultValues?.country} required className="mt-1" />
        </div>

        <div>
          <Label>Company phone</Label>
          <Input name="phone" defaultValue={defaultValues?.phone} className="mt-1" />
        </div>
        <div>
          <Label>Company email</Label>
          <Input name="email" type="email" defaultValue={defaultValues?.email} className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label>Website URL</Label>
          <Input
            name="websiteUrl"
            defaultValue={defaultValues?.websiteUrl}
            placeholder="https://example.com"
            className="mt-1"
          />
        </div>

        <div>
          <Label>Lead Type</Label>
          <Select name="leadTypeId" defaultValue={defaultValues?.leadTypeId ?? ""} required className="mt-1">
            <option value="" disabled>
              Choose a lead type
            </option>
            {leadTypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Pipeline Stage</Label>
          <Select
            name="pipelineStageId"
            defaultValue={defaultValues?.pipelineStageId ?? ""}
            required
            className="mt-1"
          >
            <option value="" disabled>
              Choose a stage
            </option>
            {pipelineStages.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Assigned salesperson</Label>
          <Select
            name="assignedToId"
            defaultValue={defaultValues?.assignedToId ?? ""}
            required
            className="mt-1"
          >
            <option value="" disabled>
              Choose a salesperson
            </option>
            {salespeople.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Competitor</Label>
          <Select name="competitorId" defaultValue={defaultValues?.competitorId ?? ""} className="mt-1">
            <option value="">None</option>
            {competitors.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Trivia status</Label>
          <Select
            name="triviaStatus"
            defaultValue={defaultValues?.triviaStatus ?? "UNCERTAIN"}
            required
            className="mt-1"
          >
            <option value="CURRENT_TRIVIA">Current Trivia</option>
            <option value="NO_CURRENT_TRIVIA">No Current Trivia</option>
            <option value="UNCERTAIN">Uncertain</option>
          </Select>
        </div>
        <div>
          <Label>Next follow-up date</Label>
          <Input
            name="nextFollowUpAt"
            type="date"
            defaultValue={defaultValues?.nextFollowUpAt}
            className="mt-1"
          />
        </div>

        <div className="sm:col-span-2">
          <Label>Notes</Label>
          <Textarea name="notes" defaultValue={defaultValues?.notes} rows={4} className="mt-1" />
        </div>
      </div>

      {state?.error && <FieldError>{state.error}</FieldError>}

      {state?.duplicates && state.duplicates.length > 0 && (
        <Alert tone="warning" className="block space-y-3">
          <h3 className="font-bold">This looks like it might already exist</h3>
          <p className="font-normal">
            The following {state.duplicates.length === 1 ? "company matches" : "companies match"} on name, address,
            website, phone, or email:
          </p>
          <ul className="space-y-2">
            {state.duplicates.map((duplicate) => (
              <li key={duplicate.id} className="rounded-lg border border-amber-200 bg-white p-3 font-normal text-text">
                <Link href={`/companies/${duplicate.id}`} className="font-bold text-secondary hover:underline" target="_blank">
                  {duplicate.name}
                </Link>
                <span className="text-text-muted">
                  {" "}
                  — {duplicate.city}, {duplicate.region}
                </span>
                <div className="mt-1 text-xs text-text-muted">Matched on: {duplicate.matchedOn.join(", ")}</div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/companies"
              className="rounded-lg border border-border-strong bg-surface-raised px-4 py-2 text-sm font-semibold text-text hover:bg-black/5"
            >
              Cancel
            </Link>
            {isAdmin && (
              <button
                type="submit"
                onClick={() => {
                  if (overrideRef.current) overrideRef.current.value = "true";
                }}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
              >
                Add anyway (Administrator override)
              </button>
            )}
          </div>
        </Alert>
      )}

      {!(state?.duplicates && state.duplicates.length > 0) && (
        <Button type="submit" disabled={pending} variant="primary" className="px-6 py-3">
          {pending ? "Saving..." : submitLabel}
        </Button>
      )}
    </form>
  );
}
