"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CirclePlus, X, Link as LinkIcon } from "lucide-react";
import { addEmailTemplateLink, removeEmailTemplateLink } from "../actions";
import { Card, SectionHeading } from "@/components/ui/card";
import { Input, FieldError } from "@/components/ui/field";

export type TemplateLinkRow = { id: string; label: string; url: string };

export function LinksPanel({ templateId, links, canEdit }: { templateId: string; links: TemplateLinkRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(formData: FormData) {
    startTransition(async () => {
      const result = await addEmailTemplateLink(templateId, undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setError(null);
        setAdding(false);
        router.refresh();
      }
    });
  }

  function handleRemove(linkId: string) {
    startTransition(async () => {
      await removeEmailTemplateLink(templateId, linkId);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionHeading>Standard links</SectionHeading>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-sm font-bold text-secondary hover:underline"
          >
            <CirclePlus size={15} />
            Add link
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-text-muted">
        A label and an external URL (e.g. a Google Drive or OneDrive/Sync link) offered as a standard attachment whenever this template is
        used — not an uploaded file. Users can add or remove links per send in the composer.
      </p>

      {links.length === 0 && !adding && <p className="mt-2 text-sm text-text-muted">No standard links yet.</p>}

      {links.length > 0 && (
        <ul className="mt-3 space-y-2">
          {links.map((link) => (
            <li key={link.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm">
              <div className="flex items-center gap-2 overflow-hidden">
                <LinkIcon size={14} className="shrink-0 text-text-muted" />
                <div className="overflow-hidden">
                  <p className="truncate font-semibold text-text">{link.label}</p>
                  <p className="truncate text-xs text-text-muted">{link.url}</p>
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleRemove(link.id)}
                  className="shrink-0 rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                  aria-label={`Remove link ${link.label}`}
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form action={handleAdd} className="mt-3 grid gap-2 rounded-lg border border-dashed border-border-strong bg-black/[0.02] p-3 sm:grid-cols-2">
          <Input name="label" placeholder="Label (e.g. Menu PDF)" required autoFocus className="py-1.5" />
          <Input name="url" placeholder="https://drive.google.com/..." required className="py-1.5" />
          {error && (
            <div className="sm:col-span-2">
              <FieldError>{error}</FieldError>
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
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
