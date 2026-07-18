"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import type { CompanyFormState } from "./actions";

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

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100";
  const labelClass = "text-sm font-semibold text-slate-700";

  return (
    <form action={formAction} className="space-y-6">
      <input ref={overrideRef} type="hidden" name="overrideDuplicates" defaultValue="false" />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Company name</label>
          <input name="name" defaultValue={defaultValues?.name} required className={`mt-1 ${inputClass}`} />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Street address</label>
          <input name="address1" defaultValue={defaultValues?.address1} className={`mt-1 ${inputClass}`} />
        </div>

        <div>
          <label className={labelClass}>City</label>
          <input name="city" defaultValue={defaultValues?.city} required className={`mt-1 ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>State / Province</label>
          <input name="region" defaultValue={defaultValues?.region} required className={`mt-1 ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>ZIP / Postal code</label>
          <input name="postalCode" defaultValue={defaultValues?.postalCode} className={`mt-1 ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Country</label>
          <input name="country" defaultValue={defaultValues?.country} required className={`mt-1 ${inputClass}`} />
        </div>

        <div>
          <label className={labelClass}>Company phone</label>
          <input name="phone" defaultValue={defaultValues?.phone} className={`mt-1 ${inputClass}`} />
        </div>
        <div>
          <label className={labelClass}>Company email</label>
          <input name="email" type="email" defaultValue={defaultValues?.email} className={`mt-1 ${inputClass}`} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Website URL</label>
          <input
            name="websiteUrl"
            defaultValue={defaultValues?.websiteUrl}
            placeholder="https://example.com"
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass}>Lead Type</label>
          <select name="leadTypeId" defaultValue={defaultValues?.leadTypeId ?? ""} required className={`mt-1 ${inputClass}`}>
            <option value="" disabled>
              Choose a lead type
            </option>
            {leadTypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Pipeline Stage</label>
          <select
            name="pipelineStageId"
            defaultValue={defaultValues?.pipelineStageId ?? ""}
            required
            className={`mt-1 ${inputClass}`}
          >
            <option value="" disabled>
              Choose a stage
            </option>
            {pipelineStages.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Assigned salesperson</label>
          <select
            name="assignedToId"
            defaultValue={defaultValues?.assignedToId ?? ""}
            required
            className={`mt-1 ${inputClass}`}
          >
            <option value="" disabled>
              Choose a salesperson
            </option>
            {salespeople.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Competitor</label>
          <select name="competitorId" defaultValue={defaultValues?.competitorId ?? ""} className={`mt-1 ${inputClass}`}>
            <option value="">None</option>
            {competitors.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Trivia status</label>
          <select
            name="triviaStatus"
            defaultValue={defaultValues?.triviaStatus ?? "UNCERTAIN"}
            required
            className={`mt-1 ${inputClass}`}
          >
            <option value="CURRENT_TRIVIA">Current Trivia</option>
            <option value="NO_CURRENT_TRIVIA">No Current Trivia</option>
            <option value="UNCERTAIN">Uncertain</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Next follow-up date</label>
          <input
            name="nextFollowUpAt"
            type="date"
            defaultValue={defaultValues?.nextFollowUpAt}
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea name="notes" defaultValue={defaultValues?.notes} rows={4} className={`mt-1 ${inputClass}`} />
        </div>
      </div>

      {state?.error && <p className="text-sm font-semibold text-red-600">{state.error}</p>}

      {state?.duplicates && state.duplicates.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h3 className="font-bold text-amber-900">This looks like it might already exist</h3>
          <p className="mt-1 text-sm text-amber-800">
            The following {state.duplicates.length === 1 ? "company matches" : "companies match"} on name, address,
            website, phone, or email:
          </p>
          <ul className="mt-3 space-y-2">
            {state.duplicates.map((duplicate) => (
              <li key={duplicate.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
                <Link href={`/companies/${duplicate.id}`} className="font-bold text-blue-600 hover:underline" target="_blank">
                  {duplicate.name}
                </Link>
                <span className="text-slate-500">
                  {" "}
                  — {duplicate.city}, {duplicate.region}
                </span>
                <div className="mt-1 text-xs text-slate-500">Matched on: {duplicate.matchedOn.join(", ")}</div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/companies"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
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
        </div>
      )}

      {!(state?.duplicates && state.duplicates.length > 0) && (
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white shadow-lg shadow-blue-200 disabled:opacity-60"
        >
          {pending ? "Saving..." : submitLabel}
        </button>
      )}
    </form>
  );
}
