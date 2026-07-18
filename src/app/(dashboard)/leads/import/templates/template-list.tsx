"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteImportTemplate } from "./actions";

export function TemplateList({ templates }: { templates: { id: string; name: string; createdByName: string }[] }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Created by</th>
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr key={template.id} className="border-t border-slate-100">
              <td className="px-5 py-4 font-semibold">{template.name}</td>
              <td className="px-5 py-4 text-slate-500">{template.createdByName}</td>
              <td className="px-5 py-4 text-right">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startTransition(() => deleteImportTemplate(template.id))}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${template.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {templates.length === 0 && (
            <tr>
              <td colSpan={3} className="px-5 py-8 text-center text-slate-500">
                No saved mapping templates yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
