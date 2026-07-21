"use client";

import { useActionState } from "react";
import { Label, Input, Select, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { createScheduledReport } from "./actions";

export function ScheduledReportForm({
  reportOptions,
  salespeople,
}: {
  reportOptions: { key: string; label: string }[];
  salespeople: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createScheduledReport, undefined);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label>Schedule name</Label>
        <Input name="name" required className="mt-1" placeholder="Weekly pipeline summary" />
      </div>
      <div>
        <Label>Report</Label>
        <Select name="reportKey" required className="mt-1" defaultValue="">
          <option value="" disabled>
            Choose a report
          </option>
          {reportOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Cadence</Label>
        <Select name="cadence" required className="mt-1" defaultValue="">
          <option value="" disabled>
            Choose a cadence
          </option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
        </Select>
      </div>
      <div>
        <Label>Recipients</Label>
        <Select name="recipientIds" multiple required className="mt-1 h-32">
          {salespeople.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
      </div>

      {state?.error && (
        <div className="sm:col-span-2">
          <FieldError>{state.error}</FieldError>
        </div>
      )}

      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending} className="px-6 py-2.5">
          {pending ? "Creating..." : "Create schedule"}
        </Button>
      </div>
    </form>
  );
}
