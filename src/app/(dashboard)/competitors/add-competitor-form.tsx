"use client";

import { useActionState } from "react";
import { CirclePlus } from "lucide-react";
import { createCompetitor } from "./actions";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function AddCompetitorForm() {
  const [state, action, pending] = useActionState(createCompetitor, undefined);

  return (
    <form action={action} className="rounded-2xl border border-dashed border-border-strong bg-black/[0.02] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input name="name" placeholder="Competitor name" required className="flex-1" />
        <Input name="websiteUrl" placeholder="https://example.com (optional)" className="flex-1" />
        <Input name="locationCount" type="number" min={0} step={1} placeholder="Locations" className="sm:w-32" />
        <Button type="submit" disabled={pending} variant="primary">
          <CirclePlus size={16} />
          {pending ? "Adding..." : "Add"}
        </Button>
      </div>
      {state?.error && <p className="mt-2 text-xs font-semibold text-danger">{state.error}</p>}
    </form>
  );
}
