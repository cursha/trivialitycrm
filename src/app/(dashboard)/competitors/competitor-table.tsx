"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { setCompetitorActive, deleteCompetitor, updateCompetitor } from "./actions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";

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
    <Card className="overflow-hidden p-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/5 text-xs uppercase text-text-muted">
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
            <tr key={competitor.id} className="border-t border-border align-top">
              <td className="px-5 py-4">
                {editingId === competitor.id ? (
                  <form action={(formData) => handleUpdate(competitor.id, formData)} className="space-y-2">
                    <Input name="name" defaultValue={competitor.name} autoFocus className="py-1" />
                    <Input name="websiteUrl" defaultValue={competitor.websiteUrl ?? ""} placeholder="https://example.com" className="py-1" />
                    <Input name="locationCount" type="number" min={0} step={1} defaultValue={competitor.locationCount} className="py-1" />
                    <div className="flex gap-2">
                      <button type="submit" className="rounded bg-primary px-2 py-1 text-xs font-bold text-white hover:bg-primary-hover">
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded border border-border-strong px-2 py-1 text-xs font-semibold text-text hover:bg-black/5"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <span className="font-semibold text-text">{competitor.name}</span>
                )}
                {rowErrors[competitor.id] && (
                  <p className="mt-1 text-xs font-semibold text-danger">{rowErrors[competitor.id]}</p>
                )}
              </td>
              <td className="px-5 py-4">
                {competitor.websiteUrl ? (
                  <a
                    href={competitor.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-secondary hover:underline"
                  >
                    {competitor.websiteUrl}
                  </a>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </td>
              <td className="px-5 py-4">
                <span className="font-bold text-text">{competitor.locationCount}</span>
              </td>
              <td className="px-5 py-4">
                {canManage ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => startTransition(() => setCompetitorActive(competitor.id, !competitor.active))}
                  >
                    <Badge tone={ACTIVE_TONE[competitor.active ? "active" : "inactive"]}>
                      {competitor.active ? "Active" : "Inactive"}
                    </Badge>
                  </button>
                ) : (
                  <Badge tone={ACTIVE_TONE[competitor.active ? "active" : "inactive"]}>
                    {competitor.active ? "Active" : "Inactive"}
                  </Badge>
                )}
              </td>
              {canManage && (
                <td className="px-5 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditingId(competitor.id)}
                      className="rounded p-1.5 text-text-muted hover:bg-black/5 hover:text-text"
                      aria-label={`Edit ${competitor.name}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleDelete(competitor.id, competitor.name)}
                      className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
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
              <td colSpan={canManage ? 5 : 4} className="px-5 py-8 text-center text-text-muted">
                No competitors yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
