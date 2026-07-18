"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, CirclePlus } from "lucide-react";
import { createContact, updateContact, deleteContact } from "./actions";

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  phone: string | null;
  email: string | null;
};

export function ContactsPanel({ companyId, contacts, canEdit }: { companyId: string; contacts: ContactRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inputClass =
    "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const result = await createContact(companyId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setAdding(false);
        router.refresh();
      }
    });
  }

  function handleUpdate(contactId: string, formData: FormData) {
    startTransition(async () => {
      const result = await updateContact(companyId, contactId, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setEditingId(null);
        router.refresh();
      }
    });
  }

  function handleDelete(contactId: string, name: string) {
    if (!window.confirm(`Remove contact "${name}"?`)) return;
    startTransition(async () => {
      const result = await deleteContact(companyId, contactId);
      if (result?.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Contacts</h2>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline"
          >
            <CirclePlus size={15} />
            Add contact
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}

      {contacts.length === 0 && !adding && <p className="mt-2 text-sm text-slate-500">No contacts yet.</p>}

      <ul className="mt-3 space-y-2">
        {contacts.map((contact) =>
          editingId === contact.id ? (
            <li key={contact.id} className="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
              <form action={(formData) => handleUpdate(contact.id, formData)} className="grid gap-2 sm:grid-cols-2">
                <input name="firstName" defaultValue={contact.firstName} placeholder="First name" required className={inputClass} />
                <input name="lastName" defaultValue={contact.lastName} placeholder="Last name" required className={inputClass} />
                <input name="title" defaultValue={contact.title ?? ""} placeholder="Title" className={inputClass} />
                <input name="phone" defaultValue={contact.phone ?? ""} placeholder="Phone" className={inputClass} />
                <input name="email" defaultValue={contact.email ?? ""} placeholder="Email" className={`sm:col-span-2 ${inputClass}`} />
                <div className="flex gap-2 sm:col-span-2">
                  <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </li>
          ) : (
            <li key={contact.id} className="flex items-start justify-between rounded-lg border border-slate-100 p-3 text-sm">
              <div>
                <p className="font-semibold">
                  {contact.firstName} {contact.lastName}
                  {contact.title && <span className="ml-2 font-normal text-slate-500">{contact.title}</span>}
                </p>
                <p className="text-slate-500">{[contact.phone, contact.email].filter(Boolean).join(" · ")}</p>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setEditingId(contact.id)}
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`Edit ${contact.firstName} ${contact.lastName}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDelete(contact.id, `${contact.firstName} ${contact.lastName}`)}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remove ${contact.firstName} ${contact.lastName}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </li>
          ),
        )}
      </ul>

      {adding && (
        <form action={handleCreate} className="mt-3 grid gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 sm:grid-cols-2">
          <input name="firstName" placeholder="First name" required autoFocus className={inputClass} />
          <input name="lastName" placeholder="Last name" required className={inputClass} />
          <input name="title" placeholder="Title" className={inputClass} />
          <input name="phone" placeholder="Phone" className={inputClass} />
          <input name="email" placeholder="Email" className={`sm:col-span-2 ${inputClass}`} />
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">
              {isPending ? "Saving..." : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
