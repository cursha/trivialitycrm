"use client";

import { useActionState } from "react";
import { CirclePlus } from "lucide-react";
import { createCompetitor } from "./actions";

export function AddCompetitorForm() {
  const [state, action, pending] = useActionState(createCompetitor, undefined);

  return (
    <form action={action} className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <input
          name="name"
          placeholder="Competitor name"
          required
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
        <input
          name="websiteUrl"
          placeholder="https://example.com (optional)"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
        <button
          type="submit"
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
        >
          <CirclePlus size={16} />
          {pending ? "Adding..." : "Add"}
        </button>
      </div>
      {state?.error && <p className="mt-2 text-xs font-semibold text-red-600">{state.error}</p>}
    </form>
  );
}
