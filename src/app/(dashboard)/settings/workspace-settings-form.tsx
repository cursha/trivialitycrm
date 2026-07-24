"use client";

import { useActionState } from "react";
import { updateWorkspaceSettings } from "./actions";
import { Card, SectionHeading } from "@/components/ui/card";
import { Label, Input, Textarea, HelpText, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function WorkspaceSettingsForm({
  defaultValues,
}: {
  defaultValues: {
    noActivityThresholdDays: number;
    newlyAssignedThresholdDays: number;
    mailingAddress: string | null;
    quietHoursStartHour: number | null;
    quietHoursEndHour: number | null;
  };
}) {
  const [state, action, pending] = useActionState(updateWorkspaceSettings, undefined);

  return (
    <Card>
      <SectionHeading>Sales Workspace thresholds</SectionHeading>
      <p className="mt-1 text-sm text-text-muted">
        Controls when a lead is flagged as newly assigned or stale on the daily priority list.
      </p>
      <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label>No-activity threshold (days)</Label>
          <Input
            name="noActivityThresholdDays"
            type="number"
            min={1}
            max={365}
            defaultValue={defaultValues.noActivityThresholdDays}
            required
            className="mt-1"
          />
          <HelpText className="mt-1">A lead with no logged activity for this many days is flagged as stale.</HelpText>
        </div>
        <div>
          <Label>Newly-assigned window (days)</Label>
          <Input
            name="newlyAssignedThresholdDays"
            type="number"
            min={1}
            max={365}
            defaultValue={defaultValues.newlyAssignedThresholdDays}
            required
            className="mt-1"
          />
          <HelpText className="mt-1">A lead assigned within this many days counts as &quot;newly assigned.&quot;</HelpText>
        </div>
        <div className="sm:col-span-2">
          <Label>Mailing address</Label>
          <Textarea
            name="mailingAddress"
            rows={2}
            defaultValue={defaultValues.mailingAddress ?? ""}
            placeholder="123 Main St, Springfield, ON, Canada"
            className="mt-1"
          />
          <HelpText className="mt-1">
            CAN-SPAM requires a valid physical mailing address in every commercial email — resolved via the{" "}
            <code>{"{{sender.mailingAddress}}"}</code> template placeholder.
          </HelpText>
        </div>
        <div>
          <Label>Quiet hours start (optional)</Label>
          <Input
            name="quietHoursStartHour"
            type="number"
            min={0}
            max={23}
            defaultValue={defaultValues.quietHoursStartHour ?? ""}
            placeholder="e.g. 21"
            className="mt-1"
          />
        </div>
        <div>
          <Label>Quiet hours end (optional)</Label>
          <Input
            name="quietHoursEndHour"
            type="number"
            min={0}
            max={23}
            defaultValue={defaultValues.quietHoursEndHour ?? ""}
            placeholder="e.g. 7"
            className="mt-1"
          />
          <HelpText className="mt-1">
            Blocks immediate CRM outreach sends and defers scheduled/sequence sends during this window (24-hour, business time zone). Leave both blank to
            disable. A start after end wraps past midnight (e.g. 21 → 7). Does not affect password-reset or other system email.
          </HelpText>
        </div>
        {state?.error && (
          <div className="sm:col-span-2">
            <FieldError>{state.error}</FieldError>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending} variant="primary">
            {pending ? "Saving..." : "Save thresholds"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
