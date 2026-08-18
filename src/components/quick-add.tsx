"use client";

import { useState, useEffect, useRef, useCallback, useActionState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { getQuickAddOptions, quickAddCompanySearch, type QuickAddOptions, type QuickAddCompanyOption } from "@/app/(dashboard)/quick-add/actions";
import { createCompany, type CompanyFormState } from "@/app/(dashboard)/companies/actions";
import { createContact } from "@/app/(dashboard)/companies/[id]/contacts/actions";
import { createActivity } from "@/app/(dashboard)/companies/[id]/activities/actions";
import { createTask } from "@/app/(dashboard)/companies/[id]/tasks/actions";
import { Label, Input, Select, Textarea, FieldError } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useFocusTrap } from "@/hooks/use-focus-trap";

type Tab = "company" | "contact" | "note" | "activity" | "follow-up";

const TABS: { key: Tab; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "contact", label: "Contact" },
  { key: "note", label: "Note" },
  { key: "activity", label: "Activity" },
  { key: "follow-up", label: "Follow-up" },
];

export function QuickAdd({ canAddLeads, canEditLeads }: { canAddLeads: boolean; canEditLeads: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(canAddLeads ? "company" : "contact");
  const [options, setOptions] = useState<QuickAddOptions | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<QuickAddCompanyOption | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, open);

  const availableTabs = TABS.filter((t) => (t.key === "company" ? canAddLeads : canEditLeads));

  const close = useCallback(() => {
    setOpen(false);
    setTab(canAddLeads ? "company" : "contact");
    setSelectedCompany(null);
    openerRef.current?.focus();
  }, [canAddLeads]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    if (open) document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, close]);

  function openModal() {
    setOpen(true);
    if (!options) void getQuickAddOptions().then(setOptions);
  }

  function switchTab(newTab: Tab) {
    setTab(newTab);
    setSelectedCompany(null);
  }

  if (availableTabs.length === 0) return null;

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={openModal}
        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary-hover"
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Quick Add</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-near-black/40 p-4 pt-20" onClick={close} aria-hidden="true">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Quick add"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-surface-raised shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-bold text-text">Quick Add</h2>
              <button type="button" onClick={close} aria-label="Close quick add" className="rounded p-1 text-text-muted hover:bg-black/5">
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-1 border-b border-border px-3 pt-2">
              {availableTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => switchTab(t.key)}
                  className={`rounded-t-lg px-3 py-2 text-xs font-semibold ${
                    tab === t.key ? "border-b-2 border-secondary text-secondary" : "text-text-muted hover:text-text"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-4">
              {tab === "company" ? (
                <QuickAddCompanyForm options={options} />
              ) : !selectedCompany ? (
                <CompanyPicker onSelect={setSelectedCompany} />
              ) : tab === "contact" ? (
                <QuickAddContactForm companyId={selectedCompany.id} companyLabel={`${selectedCompany.name} — ${selectedCompany.city}, ${selectedCompany.region}`} onChangeCompany={() => setSelectedCompany(null)} onDone={close} />
              ) : tab === "note" ? (
                <QuickAddActivityForm companyId={selectedCompany.id} companyLabel={`${selectedCompany.name} — ${selectedCompany.city}, ${selectedCompany.region}`} presetType="NOTE" onChangeCompany={() => setSelectedCompany(null)} onDone={close} />
              ) : tab === "activity" ? (
                <QuickAddActivityForm companyId={selectedCompany.id} companyLabel={`${selectedCompany.name} — ${selectedCompany.city}, ${selectedCompany.region}`} onChangeCompany={() => setSelectedCompany(null)} onDone={close} />
              ) : (
                <QuickAddFollowUpForm
                  companyId={selectedCompany.id}
                  companyLabel={`${selectedCompany.name} — ${selectedCompany.city}, ${selectedCompany.region}`}
                  defaultAssigneeId={options?.currentUserId ?? ""}
                  onChangeCompany={() => setSelectedCompany(null)}
                  onDone={close}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CompanyPicker({ onSelect }: { onSelect: (company: QuickAddCompanyOption) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuickAddCompanyOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      const found = await quickAddCompanySearch(query);
      setResults(found);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div>
      <Label>Find the company first</Label>
      <Input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length >= 2) setSearching(true);
        }}
        placeholder="Type a company name…"
        className="mt-1"
      />
      <div className="mt-2 space-y-1">
        {query.trim().length < 2 && <p className="text-sm text-text-muted">Type at least 2 characters.</p>}
        {query.trim().length >= 2 && searching && <p className="text-sm text-text-muted">Searching…</p>}
        {query.trim().length >= 2 && !searching && results.length === 0 && <p className="text-sm text-text-muted">No matches — you may need to add the company first.</p>}
        {results.map((company) => (
          <button
            key={company.id}
            type="button"
            onClick={() => onSelect(company)}
            className="block w-full rounded-lg border border-border-strong px-3 py-2 text-left text-sm hover:bg-black/5"
          >
            <span className="font-semibold text-text">{company.name}</span>
            <span className="ml-2 text-text-muted">
              {company.city}, {company.region}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChosenCompanyBanner({ label, onChange }: { label: string; onChange: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between rounded-lg bg-black/5 px-3 py-2 text-xs">
      <span className="font-semibold text-text">{label}</span>
      <button type="button" onClick={onChange} className="font-semibold text-secondary hover:underline">
        Change
      </button>
    </div>
  );
}

function QuickAddCompanyForm({ options }: { options: QuickAddOptions | null }) {
  const wrappedAction = async (prevState: CompanyFormState, formData: FormData): Promise<CompanyFormState> => {
    const result = await createCompany(prevState, formData);
    // createCompany redirect()s on success (throws, never returns here) —
    // reaching this point at all means it returned an error/duplicate
    // state, so onDone() is deliberately never called from this wrapper;
    // the redirect itself navigates away, which unmounts this modal.
    return result;
  };
  const [state, formAction, pending] = useActionState(wrappedAction, undefined);
  const overrideRef = useRef<HTMLInputElement>(null);

  if (!options) return <p className="text-sm text-text-muted">Loading…</p>;

  return (
    <form action={formAction} className="space-y-3">
      <input ref={overrideRef} type="hidden" name="overrideDuplicates" defaultValue="false" />
      <div>
        <Label>Company name</Label>
        <Input name="name" required autoFocus className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>City</Label>
          <Input name="city" required className="mt-1" />
        </div>
        <div>
          <Label>State / Province</Label>
          <Input name="region" required className="mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Country</Label>
          <Input name="country" required className="mt-1" />
        </div>
        <div>
          <Label>Lead type</Label>
          <Select name="leadTypeId" required className="mt-1">
            <option value="">Choose…</option>
            {options.leadTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <input type="hidden" name="pipelineStageId" value={options.defaultPipelineStageId ?? ""} />
      <input type="hidden" name="triviaStatus" value="UNCERTAIN" />

      {state?.error && <FieldError>{state.error}</FieldError>}

      {state?.duplicates && state.duplicates.length > 0 ? (
        <Alert tone="warning" className="block space-y-2">
          <p className="font-bold">This looks like it might already exist</p>
          <ul className="space-y-1">
            {state.duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/companies/${d.id}`} target="_blank" className="font-semibold text-secondary hover:underline">
                  {d.name}
                </Link>
                <span className="text-text-muted">
                  {" "}
                  — {d.city}, {d.region} (matched on {d.matchedOn.join(", ")})
                </span>
              </li>
            ))}
          </ul>
          <Link href="/companies/new" className="text-sm font-semibold text-secondary hover:underline">
            Open the full form instead →
          </Link>
        </Alert>
      ) : (
        <div className="flex items-center justify-between pt-1">
          <Link href="/companies/new" className="text-xs font-semibold text-secondary hover:underline">
            Open full form
          </Link>
          <Button type="submit" disabled={pending} variant="primary">
            {pending ? "Adding…" : "Add company"}
          </Button>
        </div>
      )}
    </form>
  );
}

function QuickAddContactForm({ companyId, companyLabel, onChangeCompany, onDone }: { companyId: string; companyLabel: string; onChangeCompany: () => void; onDone: () => void }) {
  const wrappedAction = async (prevState: { error?: string } | undefined, formData: FormData) => {
    const result = await createContact(companyId, prevState, formData);
    if (!result?.error) onDone();
    return result;
  };
  const [state, formAction, pending] = useActionState(wrappedAction, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <ChosenCompanyBanner label={companyLabel} onChange={onChangeCompany} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>First name</Label>
          <Input name="firstName" required autoFocus className="mt-1" />
        </div>
        <div>
          <Label>Last name</Label>
          <Input name="lastName" required className="mt-1" />
        </div>
      </div>
      <div>
        <Label>Email (optional)</Label>
        <Input name="email" type="email" className="mt-1" />
      </div>
      <div>
        <Label>Phone (optional)</Label>
        <Input name="phone" className="mt-1" />
      </div>
      {state?.error && <FieldError>{state.error}</FieldError>}
      <div className="flex justify-between pt-1">
        <Link href={`/companies/${companyId}`} className="text-xs font-semibold text-secondary hover:underline">
          Open full form
        </Link>
        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Adding…" : "Add contact"}
        </Button>
      </div>
    </form>
  );
}

function QuickAddActivityForm({
  companyId,
  companyLabel,
  presetType,
  onChangeCompany,
  onDone,
}: {
  companyId: string;
  companyLabel: string;
  presetType?: "NOTE";
  onChangeCompany: () => void;
  onDone: () => void;
}) {
  const wrappedAction = async (prevState: { error?: string } | undefined, formData: FormData) => {
    const result = await createActivity(companyId, prevState, formData);
    if (!result?.error) onDone();
    return result;
  };
  const [state, formAction, pending] = useActionState(wrappedAction, undefined);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <form action={formAction} className="space-y-3">
      <ChosenCompanyBanner label={companyLabel} onChange={onChangeCompany} />
      {presetType ? (
        <input type="hidden" name="type" value={presetType} />
      ) : (
        <div>
          <Label>Type</Label>
          <Select name="type" required defaultValue="PHONE" className="mt-1">
            <option value="PHONE">Call</option>
            <option value="EMAIL">Email</option>
            <option value="MEETING">Meeting</option>
            <option value="DEMO">Demo</option>
            <option value="TRIAL">Trial</option>
            <option value="MATERIAL_SENT">Material sent</option>
            <option value="NOTE">Note</option>
          </Select>
        </div>
      )}
      <div>
        <Label>Date</Label>
        <Input name="occurredAt" type="date" defaultValue={today} className="mt-1" />
      </div>
      <div>
        <Label>{presetType === "NOTE" ? "Note" : "Notes"}</Label>
        <Textarea name="notes" rows={4} autoFocus required={presetType === "NOTE"} className="mt-1" />
      </div>
      {state?.error && <FieldError>{state.error}</FieldError>}
      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Saving…" : presetType === "NOTE" ? "Add note" : "Log activity"}
        </Button>
      </div>
    </form>
  );
}

function QuickAddFollowUpForm({
  companyId,
  companyLabel,
  defaultAssigneeId,
  onChangeCompany,
  onDone,
}: {
  companyId: string;
  companyLabel: string;
  defaultAssigneeId: string;
  onChangeCompany: () => void;
  onDone: () => void;
}) {
  const wrappedAction = async (prevState: { error?: string } | undefined, formData: FormData) => {
    const result = await createTask(companyId, prevState, formData);
    if (!result?.error) onDone();
    return result;
  };
  const [state, formAction, pending] = useActionState(wrappedAction, undefined);
  // Lazy useState initializer — the idiomatic React way to do a one-time
  // impure computation (Date.now()) without calling it directly in the
  // render body, which the stricter react-hooks/purity rule disallows.
  const [tomorrow] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

  return (
    <form action={formAction} className="space-y-3">
      <ChosenCompanyBanner label={companyLabel} onChange={onChangeCompany} />
      <input type="hidden" name="assignedToId" value={defaultAssigneeId} />
      <div>
        <Label>Title</Label>
        <Input name="title" required autoFocus placeholder="Follow up about…" className="mt-1" />
      </div>
      <div>
        <Label>Due</Label>
        <Input name="dueAt" type="date" defaultValue={tomorrow} required className="mt-1" />
      </div>
      <div>
        <Label>Notes (optional)</Label>
        <Textarea name="notes" rows={3} className="mt-1" />
      </div>
      {state?.error && <FieldError>{state.error}</FieldError>}
      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Scheduling…" : "Schedule follow-up"}
        </Button>
      </div>
    </form>
  );
}
