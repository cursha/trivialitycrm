"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteImportTemplate } from "./actions";
import { Card } from "@/components/ui/card";

export function TemplateList({ templates }: { templates: { id: string; name: string; createdByName: string }[] }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Card className="overflow-hidden p-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/5 text-xs uppercase text-text-muted">
          <tr>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Created by</th>
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.id} className="border-t border-border">
              <td className="px-5 py-4 font-semibold text-text">{template.name}</td>
              <td className="px-5 py-4 text-text-muted">{template.createdByName}</td>
              <td className="px-5 py-4 text-right">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startTransition(() => deleteImportTemplate(template.id))}
                  className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                  aria-label={`Delete ${template.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {templates.length === 0 && (
            <tr>
              <td colSpan={3} className="px-5 py-8 text-center text-text-muted">
                No saved mapping templates yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
