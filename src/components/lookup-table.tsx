"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Star, Trash2, X } from "lucide-react";

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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
            <tr key={item.id} className="border-t border-slate-100 align-top">
              <td className="px-5 py-4">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    disabled={isPending || index === 0}
                    onClick={() => startTransition(() => move(item.id, "up"))}
                    className="rounded border border-slate-200 p-1 disabled:opacity-30"
                    aria-label={`Move ${item.name} up`}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={isPending || index === items.length - 1}
                    onClick={() => startTransition(() => move(item.id, "down"))}
                    className="rounded border border-slate-200 p-1 disabled:opacity-30"
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
                    <input
                      name="name"
                      defaultValue={item.name}
                      autoFocus
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    />
                    <button type="submit" className="rounded p-1 text-emerald-600 hover:bg-emerald-50" aria-label="Save">
                      <Check size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        clearError(item.id);
                      }}
                      className="rounded p-1 text-slate-500 hover:bg-slate-100"
                      aria-label="Cancel"
                    >
                      <X size={16} />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{item.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label={`Rename ${item.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                )}
                {rowErrors[item.id] && <p className="mt-1 text-xs font-semibold text-red-600">{rowErrors[item.id]}</p>}
              </td>
              <td className="px-5 py-4">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => startTransition(() => setActive(item.id, !item.active))}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.active ? "Active" : "Inactive"}
                </button>
              </td>
              {setDefault && (
                <td className="px-5 py-4">
                  <button
                    type="button"
                    disabled={isPending || item.isDefault}
                    onClick={() => startTransition(() => setDefault(item.id))}
                    className={`rounded-full p-1.5 ${item.isDefault ? "text-amber-500" : "text-slate-300 hover:text-slate-500"}`}
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
                  className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={setDefault ? 5 : 4} className="px-5 py-8 text-center text-slate-500">
                Nothing here yet — add the first one below.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
