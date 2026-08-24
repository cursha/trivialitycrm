"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";
import { setEmailTemplateActive, deleteEmailTemplate, duplicateEmailTemplate } from "./actions";

export type TemplateRowData = {
  id: string;
  name: string;
  category: string | null;
  subject: string;
  language: string;
  leadTypeName: string | null;
  pipelineStageName: string | null;
  active: boolean;
  canEdit: boolean;
};

export function TemplateRow({ template }: { template: TemplateRowData }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`Delete the template "${template.name}"? This cannot be undone.`)) return;
    startTransition(() => deleteEmailTemplate(template.id));
  }

  function handleDuplicate() {
    startTransition(() => duplicateEmailTemplate(template.id));
  }

  return (
    <tr className="border-t border-border/40 align-top">
      <td className="py-2 font-medium text-text">
        {template.canEdit ? (
          <Link href={`/settings/email-templates/${template.id}/edit`} className="hover:underline">
            {template.name}
          </Link>
        ) : (
          template.name
        )}
        {template.category && <div className="text-xs text-text-muted">{template.category}</div>}
      </td>
      <td className="py-2 text-text">{template.subject}</td>
      <td className="py-2 text-text-muted">{template.leadTypeName ?? "Any"}</td>
      <td className="py-2 text-text-muted">{template.pipelineStageName ?? "Any"}</td>
      <td className="py-2 text-text-muted">{template.language}</td>
      <td className="py-2">
        {template.canEdit ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(() => setEmailTemplateActive(template.id, !template.active))}
          >
            <Badge tone={ACTIVE_TONE[template.active ? "active" : "inactive"]}>{template.active ? "Active" : "Inactive"}</Badge>
          </button>
        ) : (
          <Badge tone={ACTIVE_TONE[template.active ? "active" : "inactive"]}>{template.active ? "Active" : "Inactive"}</Badge>
        )}
      </td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-1">
          {template.canEdit && (
            <Link
              href={`/settings/email-templates/${template.id}/edit`}
              className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text"
              aria-label={`Edit ${template.name}`}
            >
              <Pencil size={16} />
            </Link>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={handleDuplicate}
            className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text"
            aria-label={`Duplicate ${template.name}`}
            title="Duplicate as a new personal template"
          >
            <Copy size={16} />
          </button>
          {template.canEdit && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleDelete}
              className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
              aria-label={`Delete ${template.name}`}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
