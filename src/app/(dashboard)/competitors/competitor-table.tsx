"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { setCompetitorActive, deleteCompetitor, updateCompetitor } from "./actions";

export type CompetitorRow = {
  id: string;
  name: string;
  websiteUrl: string | null;
  active: boolean;
  locationCount: number;
};

export function CompetitorTable({ competitors, canManage }: { competitors: CompetitorRow[]; canManage: boolean }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function handleUpdate(id: string, formData: FormData) {
    startTransition(async () => {
      const result = await updateCompetitor(id, formData);
      if (result?.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      } else {
        setRowErrors((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setEditingId(null);
      }
    });
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteCompetitor(id);
      if (result?.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Website</th>
            <th className="px-5 py-3">Locations</th>
            <th className="px-5 py-3">Status</th>
            {canManage && <th className="px-5 py-3 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {competitors.map((competitor) => (
            <tr key={competitor.id} className="border-t border-slate-100 align-top">
              <td className="px-5 py-4">
                {editingId === competitor.id ? (
                  <form action={(formData) => handleUpdate(competitor.id, formData)} className="space-y-2">
                    <input
                      name="name"
                      defaultValue={competitor.name}
                      autoFocus
                      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    />
                    <input
                      name="websiteUrl"
                      defaultValue={competitor.websiteUrl ?? ""}
                      placeholder="https://example.com"
                      className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    />
                    <div className="flex gap-2">
                      <button type="submit" className="rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white">
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <span className="font-semibold">{competitor.name}</span>
                )}
                {rowErrors[competitor.id] && (
                  <p className="mt-1 text-xs font-semibold text-red-600">{rowErrors[competitor.id]}</p>
                )}
              </td>
              <td className="px-5 py-4">
                {competitor.websiteUrl ? (
                  <a
                    href={competitor.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-blue-600 hover:underline"
                  >
                    {competitor.websiteUrl}
                  </a>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="px-5 py-4">
                <Link href={`/companies?competitorId=${competitor.id}`} className="font-bold text-blue-600 hover:underline">
                  {competitor.locationCount}
                </Link>
              </td>
              <td className="px-5 py-4">
                {canManage ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => startTransition(() => setCompetitorActive(competitor.id, !competitor.active))}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      competitor.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {competitor.active ? "Active" : "Inactive"}
                  </button>
                ) : (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${competitor.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {competitor.active ? "Active" : "Inactive"}
                  </span>
                )}
              </td>
              {canManage && (
                <td className="px-5 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(competitor.id)}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label={`Edit ${competitor.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleDelete(competitor.id, competitor.name)}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${competitor.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
          {competitors.length === 0 && (
            <tr>
              <td colSpan={canManage ? 5 : 4} className="px-5 py-8 text-center text-slate-500">
                No competitors yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
