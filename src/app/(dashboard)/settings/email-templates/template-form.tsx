"use client";

import { useActionState } from "react";
import { Label, Input, Select, Textarea, FieldError, HelpText } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { KNOWN_PLACEHOLDERS } from "@/lib/comms/templates";
import type { ActionResult } from "./actions";

type Option = { id: string; name: string };

export function TemplateForm({
  action,
  leadTypes,
  pipelineStages,
  canManageShared,
  defaultValues,
  submitLabel,
}: {
  action: (state: ActionResult, formData: FormData) => Promise<ActionResult>;
  leadTypes: Option[];
  pipelineStages: Option[];
  canManageShared: boolean;
  defaultValues?: {
    name: string;
    category: string | null;
    subject: string;
    body: string;
    visibility: "PERSONAL" | "SHARED";
    leadTypeId: string | null;
    pipelineStageId: string | null;
    language: string;
    active: boolean;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label>Name</Label>
        <Input name="name" required className="mt-1" defaultValue={defaultValues?.name} placeholder="Intro follow-up" />
      </div>
      <div>
        <Label>Category</Label>
        <Input name="category" className="mt-1" defaultValue={defaultValues?.category ?? ""} placeholder="Optional" />
      </div>

      {!defaultValues && (
        <div>
          <Label>Visibility</Label>
          <Select name="visibility" required className="mt-1" defaultValue="PERSONAL">
            <option value="PERSONAL">Personal (only you)</option>
            {canManageShared && <option value="SHARED">Shared (whole team)</option>}
          </Select>
        </div>
      )}
      <div>
        <Label>Language</Label>
        <Input name="language" className="mt-1" defaultValue={defaultValues?.language ?? "en"} placeholder="en" />
      </div>

      <div>
        <Label>Lead type</Label>
        <Select name="leadTypeId" className="mt-1" defaultValue={defaultValues?.leadTypeId ?? ""}>
          <option value="">Any</option>
          {leadTypes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Pipeline stage</Label>
        <Select name="pipelineStageId" className="mt-1" defaultValue={defaultValues?.pipelineStageId ?? ""}>
          <option value="">Any</option>
          {pipelineStages.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="sm:col-span-2">
        <Label>Subject</Label>
        <Input name="subject" required className="mt-1" defaultValue={defaultValues?.subject} />
      </div>
      <div className="sm:col-span-2">
        <Label>Body</Label>
        <Textarea name="body" required rows={8} className="mt-1" defaultValue={defaultValues?.body} />
        <HelpText className="mt-1">
          Placeholders: {KNOWN_PLACEHOLDERS.map((token) => `{{${token}}}`).join(", ")}. An unresolved placeholder blocks sending
          rather than going out blank.
        </HelpText>
      </div>

      <div className="flex items-center gap-2 sm:col-span-2">
        <input
          type="checkbox"
          id="active"
          name="active"
          defaultChecked={defaultValues?.active ?? true}
          className="h-4 w-4 rounded border-border-strong"
        />
        <Label htmlFor="active">Active</Label>
      </div>

      {state?.error && (
        <div className="sm:col-span-2">
          <FieldError>{state.error}</FieldError>
        </div>
      )}

      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending} className="px-6 py-2.5">
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
