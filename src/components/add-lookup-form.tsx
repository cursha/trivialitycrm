"use client";

import { useActionState } from "react";
import { CirclePlus } from "lucide-react";

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
    <form action={action} className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="flex-1">
        <input
          name="name"
          placeholder={placeholder}
          required
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
        {state?.error && <p className="mt-1 text-xs font-semibold text-red-600">{state.error}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
      >
        <CirclePlus size={16} />
        {pending ? "Adding..." : "Add"}
      </button>
    </form>
  );
}
