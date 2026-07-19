"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Star, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { ACTIVE_TONE } from "@/lib/ui/status-tones";

export type LookupItem = {
  id: string;
  name: string;
  active: boolean;
  isDefault?: boolean;
};

type ActionResult = { error?: string } | undefined;

export function LookupTable({
  items,
  rename,
  setActive,
  move,
  remove,
  setDefault,
  defaultLabel = "Default",
}: {
  items: LookupItem[];
  rename: (id: string, formData: FormData) => Promise<ActionResult>;
  setActive: (id: string, active: boolean) => Promise<void>;
  move: (id: string, direction: "up" | "down") => Promise<void>;
  remove: (id: string) => Promise<ActionResult>;
  setDefault?: (id: string) => Promise<void>;
  defaultLabel?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function clearError(id: string) {
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function handleRename(id: string, formData: FormData) {
    startTransition(async () => {
      const result = await rename(id, formData);
      if (result?.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      } else {
        clearError(id);
        setEditingId(null);
      }
    });
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await remove(id);
      if (result?.error) {
        setRowErrors((prev) => ({ ...prev, [id]: result.error! }));
      } else {
        clearError(id);
      }
    });
  }

  return (
    <Card className="overflow-hidden p-0">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/5 text-xs uppercase text-text-muted">
          <tr>
            <th className="px-5 py-3">Order</th>
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Status</th>
            {setDefault && <th className="px-5 py-3">{defaultLabel}</th>}
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id} className="border-t border-border align-top">
              <td className="px-5 py-4">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    disabled={isPending || index === 0}
                    onClick={() => startTransition(() => move(item.id, "up"))}
                    className="rounded border border-border-strong p-1 text-text disabled:opacity-30"
                    aria-label={`Move ${item.name} up`}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={isPending || index === items.length - 1}
                    onClick={() => startTransition(() => move(item.id, "down"))}
                    className="rounded border border-border-strong p-1 text-text disabled:opacity-30"
                    aria-label={`Move ${item.name} down`}
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </td>
              <td className="px-5 py-4">
                {editingId === item.id ? (
                  <form
                    action={(formData) => handleRename(item.id, formData)}
                    className="flex items-center gap-2"
                  >
                    <Input name="name" defaultValue={item.name} autoFocus className="py-1" />
                    <button type="submit" className="rounded p-1 text-emerald-600 hover:bg-emerald-50" aria-label="Save">
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        clearError(item.id);
                      }}
                      className="rounded p-1 text-text-muted hover:bg-black/5"
                      aria-label="Cancel"
                    >
                      <X size={16} />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-text">{item.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      className="rounded p-1 text-text-muted hover:bg-black/5 hover:text-text"
                      aria-label={`Rename ${item.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )}
                {rowErrors[item.id] && <p className="mt-1 text-xs font-semibold text-danger">{rowErrors[item.id]}</p>}
              </td>
              <td className="px-5 py-4">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startTransition(() => setActive(item.id, !item.active))}
                >
                  <Badge tone={ACTIVE_TONE[item.active ? "active" : "inactive"]}>{item.active ? "Active" : "Inactive"}</Badge>
                </button>
              </td>
              {setDefault && (
                <td className="px-5 py-4">
                  <button
                    type="button"
                    disabled={isPending || item.isDefault}
                    onClick={() => startTransition(() => setDefault(item.id))}
                    className={`rounded-full p-1.5 ${item.isDefault ? "text-amber-500" : "text-border-strong hover:text-text-muted"}`}
                    aria-label={item.isDefault ? `${item.name} is the default` : `Make ${item.name} the default`}
                  >
                    <Star size={16} fill={item.isDefault ? "currentColor" : "none"} />
                  </button>
                </td>
              )}
              <td className="px-5 py-4 text-right">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(item.id, item.name)}
                  className="rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={setDefault ? 5 : 4} className="px-5 py-8 text-center text-text-muted">
                Nothing here yet — add the first one below.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
