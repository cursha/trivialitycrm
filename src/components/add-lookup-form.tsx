"use client";

import { useActionState } from "react";
import { CirclePlus } from "lucide-react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

type ActionResult = { error?: string } | undefined;

export function AddLookupForm({
  create,
  placeholder,
}: {
  create: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
  placeholder: string;
}) {
  const [state, action, pending] = useActionState(create, undefined);

  return (
    <form action={action} className="flex items-start gap-3 rounded-2xl border border-dashed border-border-strong bg-black/[0.02] p-4">
      <div className="flex-1">
        <Input name="name" placeholder={placeholder} required />
        {state?.error && <p className="mt-1 text-xs font-semibold text-danger">{state.error}</p>}
      </div>
      <Button type="submit" disabled={pending} variant="primary">
        <CirclePlus size={16} />
        {pending ? "Adding..." : "Add"}
      </Button>
    </form>
  );
}
