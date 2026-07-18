"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Pencil, Copy, Archive, ArchiveRestore } from "lucide-react";
import { duplicatePrompt, archivePrompt, restorePrompt } from "./actions";

export type PromptRow = {
  id: string;
  name: string;
  qualificationPrompt: string;
  archived: boolean;
  updatedAt: string;
};

export function PromptTable({ prompts, canManage }: { prompts: PromptRow[]; canManage: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Prompt</th>
            <th className="px-5 py-3">Status</th>
            {canManage && <th className="px-5 py-3 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {prompts.map((prompt) => (
            <tr key={prompt.id} className="border-t border-slate-100 align-top">
              <td className="px-5 py-4 font-semibold">{prompt.name}</td>
              <td className="max-w-xl px-5 py-4 text-slate-500">
                <p className="line-clamp-2">{prompt.qualificationPrompt}</p>
              </td>
              <td className="px-5 py-4">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    prompt.archived ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {prompt.archived ? "Archived" : "Active"}
                </span>
              </td>
              {canManage && (
                <td className="px-5 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Link
                      href={`/leads/prompts/${prompt.id}/edit`}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label={`Edit ${prompt.name}`}
                    >
                      <Pencil size={16} />
                    </Link>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => startTransition(() => duplicatePrompt(prompt.id))}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label={`Duplicate ${prompt.name}`}
                    >
                      <Copy size={16} />
                    </button>
                    {prompt.archived ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => startTransition(() => restorePrompt(prompt.id))}
                        className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700"
                        aria-label={`Restore ${prompt.name}`}
                      >
                        <ArchiveRestore size={16} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => startTransition(() => archivePrompt(prompt.id))}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Archive ${prompt.name}`}
                      >
                        <Archive size={16} />
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
          {prompts.length === 0 && (
            <tr>
              <td colSpan={canManage ? 4 : 3} className="px-5 py-8 text-center text-slate-500">
                No prompts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
