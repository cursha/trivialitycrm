"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, CirclePlus } from "lucide-react";
import { createContact, updateContact, deleteContact } from "./actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  emailPermitted: boolean;
  doNotContact: boolean;
};

function consentBadge(contact: ContactRow) {
  if (contact.doNotContact) return <Badge tone="danger">Do Not Contact</Badge>;
  if (contact.emailPermitted) return <Badge tone="success">Email Permitted</Badge>;
  return <Badge tone="neutral">Email Not Permitted</Badge>;
}

export function ContactsPanel({
  companyId,
  contacts,
  canEdit,
  canManageCompliance,
}: {
  companyId: string;
  contacts: ContactRow[];
  canEdit: boolean;
  canManageCompliance: boolean;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-accent">Contacts</h2>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Add contact
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-danger">{error}</p>}

      {contacts.length === 0 && !adding && <p className="mt-2 text-sm text-text-muted">No contacts yet.</p>}

      <ul className="mt-3 space-y-2">
        {contacts.map((contact) =>
          editingId === contact.id ? (
            <li key={contact.id} className="rounded-lg border border-focus/30 bg-focus/5 p-3">
              <form action={(formData) => handleUpdate(contact.id, formData)} className="grid gap-2 sm:grid-cols-2">
                <Input name="firstName" defaultValue={contact.firstName} placeholder="First name" required className="py-1.5" />
                <Input name="lastName" defaultValue={contact.lastName} placeholder="Last name" required className="py-1.5" />
                <Input name="title" defaultValue={contact.title ?? ""} placeholder="Title" className="py-1.5" />
                <Input name="phone" defaultValue={contact.phone ?? ""} placeholder="Phone" className="py-1.5" />
                <Input name="email" defaultValue={contact.email ?? ""} placeholder="Email" className="py-1.5 sm:col-span-2" />
                <div className="flex gap-2 sm:col-span-2">
                  <button type="submit" disabled={isPending} className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50">
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </li>
          ) : (
            <li key={contact.id} className="flex items-start justify-between rounded-lg border border-border p-3 text-sm">
              <div>
                <p className="font-semibold text-text">
                  {contact.firstName} {contact.lastName}
                  {contact.title && <span className="ml-2 font-normal text-text-muted">{contact.title}</span>}
                </p>
                <p className="text-text-muted">{[contact.phone, contact.email].filter(Boolean).join(" · ")}</p>
                <div className="mt-1 flex items-center gap-2">
                  {consentBadge(contact)}
                  {canManageCompliance && (
                    <Link
                      href={`/settings/communication-compliance?q=${encodeURIComponent(contact.email ?? `${contact.firstName} ${contact.lastName}`)}`}
                      className="text-xs text-secondary hover:underline"
                    >
                      Manage consent
                    </Link>
                  )}
                </div>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setEditingId(contact.id)}
                    className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text"
                    aria-label={`Edit ${contact.firstName} ${contact.lastName}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDelete(contact.id, `${contact.firstName} ${contact.lastName}`)}
                    className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
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
        <form action={handleCreate} className="mt-3 grid gap-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3 sm:grid-cols-2">
          <Input name="firstName" placeholder="First name" required autoFocus className="py-1.5" />
          <Input name="lastName" placeholder="Last name" required className="py-1.5" />
          <Input name="title" placeholder="Title" className="py-1.5" />
          <Input name="phone" placeholder="Phone" className="py-1.5" />
          <Input name="email" placeholder="Email" className="py-1.5 sm:col-span-2" />
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={isPending} className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50">
              {isPending ? "Saving..." : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-border-strong px-3 py-1.5 text-xs font-semibold text-text hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
