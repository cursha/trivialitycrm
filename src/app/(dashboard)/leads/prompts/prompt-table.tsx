"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Pencil, Copy, Archive, ArchiveRestore } from "lucide-react";
import { duplicatePrompt, archivePrompt, restorePrompt } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";

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
    <Card className="overflow-hidden p-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/5 text-xs uppercase text-text-muted">
          <tr>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Prompt</th>
            <th className="px-5 py-3">Status</th>
            {canManage && <th className="px-5 py-3 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {prompts.map((prompt) => (
            <tr key={prompt.id} className="border-t border-border align-top">
              <td className="px-5 py-4 font-semibold text-text">{prompt.name}</td>
              <td className="max-w-xl px-5 py-4 text-text-muted">
                <p className="line-clamp-2">{prompt.qualificationPrompt}</p>
              </td>
              <td className="px-5 py-4">
                <Badge tone={ACTIVE_TONE[prompt.archived ? "inactive" : "active"]}>
                  {prompt.archived ? "Archived" : "Active"}
                </Badge>
              </td>
              {canManage && (
                <td className="px-5 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    <Link
                      href={`/leads/prompts/${prompt.id}/edit`}
                      className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text"
                      aria-label={`Edit ${prompt.name}`}
                    >
                      <Pencil size={16} />
                    </Link>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => startTransition(() => duplicatePrompt(prompt.id))}
                      className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text"
                      aria-label={`Duplicate ${prompt.name}`}
                    >
                      <Copy size={16} />
                    </button>
                    {prompt.archived ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => startTransition(() => restorePrompt(prompt.id))}
                        className="rounded p-1.5 text-text-muted hover:bg-emerald-50 hover:text-emerald-700"
                        aria-label={`Restore ${prompt.name}`}
                      >
                        <ArchiveRestore size={16} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => startTransition(() => archivePrompt(prompt.id))}
                        className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
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
              <td colSpan={canManage ? 4 : 3} className="px-5 py-8 text-center text-text-muted">
                No prompts yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
